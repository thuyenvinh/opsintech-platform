import asyncio
import fcntl
import logging
import os
import pty
import struct
import tempfile
import termios
import uuid
from collections.abc import Awaitable, Callable

from fastapi import WebSocket

from app.models.assets import Keychain, LocalAsset

logger = logging.getLogger(__name__)

def build_ssh_command(asset: LocalAsset, keychain: Keychain | None = None) -> tuple[list[str], dict, list[str]]:
    ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "ConnectTimeout=15", "-p", str(asset.port)]
    env_updates = {}
    temp_files = []

    if keychain:
        if keychain.type == "ssh_key":
            fd, path = tempfile.mkstemp(text=True)
            os.write(fd, keychain.value.encode('utf-8'))
            os.close(fd)
            os.chmod(path, 0o600)
            temp_files.append(path)
            ssh_cmd.extend(["-i", path])
        elif keychain.type == "password":
            fd, path = tempfile.mkstemp(text=True)
            script_content = f"#!/usr/bin/env python3\nimport sys\nsys.stdout.write({repr(keychain.value)} + '\\n')\n"
            os.write(fd, script_content.encode('utf-8'))
            os.close(fd)
            os.chmod(path, 0o700)
            temp_files.append(path)
            env_updates["SSH_ASKPASS"] = path
            env_updates["SSH_ASKPASS_REQUIRE"] = "force"
            env_updates["DISPLAY"] = "dummy:0"
            ssh_cmd.extend(["-o", "BatchMode=no"])
            
    ssh_cmd.append(f"{asset.username}@{asset.ip}")
    return ssh_cmd, env_updates, temp_files

class LocalPTY:
    def __init__(self):
        self.pid: int | None = None
        self.fd: int | None = None

    def start(self, cmd: list[str] = ["bash", "--login"], env_updates: dict = {}):
        # Fork a child process with a new PTY
        pid, fd = pty.fork()
        if pid == 0:
            # Child process: replace with command
            env = os.environ.copy()
            env["TERM"] = "xterm-256color"
            env.update(env_updates)
            try:
                os.execvpe(cmd[0], cmd, env)
            except Exception as e:
                print(f"Failed to execute {cmd}: {e}")
                os._exit(1)
        else:
            # Parent process
            self.pid = pid
            self.fd = fd
            # Set fd to non-blocking
            flags = fcntl.fcntl(fd, fcntl.F_GETFL)
            fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    def resize(self, rows: int, cols: int):
        if self.fd is not None:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(self.fd, termios.TIOCSWINSZ, winsize)

    def write(self, data: str):
        if self.fd is not None:
            os.write(self.fd, data.encode("utf-8"))

    async def read_loop(self, callback: Callable[[str], Awaitable[None]]):
        loop = asyncio.get_event_loop()
        while self.fd is not None:
            try:
                # Use asyncio to read non-blocking from the fd
                data = await loop.run_in_executor(None, lambda: os.read(self.fd, 1024))
                if not data:
                    break
                await callback(data.decode("utf-8", errors="replace"))
            except BlockingIOError:
                await asyncio.sleep(0.01)
            except OSError as e:
                # EIO means EOF on some systems when PTY is closed
                if getattr(e, "errno", None) == 5:
                    break
                logger.error(f"PTY read error: {e}")
                break
            except Exception as e:
                logger.error(f"PTY loop error: {e}")
                break

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None
        if self.pid is not None:
            try:
                os.kill(self.pid, 9)
                os.waitpid(self.pid, 0)
            except Exception:
                pass
            self.pid = None


class TerminalSession:
    def __init__(self, session_id: str, asset_id: str, tenant_id: str = "", user_id: str = ""):
        self.session_id = session_id
        self.asset_id = asset_id
        # The caller that owns this shell, resolved server-side. Kept on the
        # session for logging and so a holder of the object can tell whose it is.
        self.tenant_id = tenant_id
        self.user_id = user_id
        self.pty: LocalPTY = LocalPTY()
        self.websockets: set[WebSocket] = set()
        self.read_task: asyncio.Task | None = None
        self.temp_files: list[str] = []
        
        # State for marker-based command execution
        self.is_executing_command = False
        self.command_output_buffer = ""
        self.command_future: asyncio.Future | None = None
        self.end_marker = ""

    async def _on_pty_output(self, data: str):
        # Buffer and detect end marker if executing command
        if self.is_executing_command and self.command_future and not self.command_future.done():
            self.command_output_buffer += data
            if self.end_marker and self.end_marker in self.command_output_buffer:
                self.command_future.set_result(self.command_output_buffer)

        # Broadcast to UI websockets only if current mode allows it
        # Agent mode (broadcast=False): do NOT send to UI, keep terminal clean
        if not getattr(self, '_current_broadcast', True):
            return

        # Filter out marker strings to keep the terminal clean
        clean_data = data
        if "__OPSINTECH_MARKER_" in clean_data:
            import re
            clean_data = re.sub(r'.*__OPSINTECH_MARKER_.*(\r\n|\n)?', '', clean_data)

        if clean_data:
            dead_ws = set()
            for ws in self.websockets:
                try:
                    await ws.send_text(clean_data)
                except Exception:
                    dead_ws.add(ws)
            
            for ws in dead_ws:
                self.websockets.remove(ws)

    def start(self, cmd: list[str], env_updates: dict, temp_files: list[str]):
        self.temp_files = temp_files
        self.pty.start(cmd=cmd, env_updates=env_updates)
        self.read_task = asyncio.create_task(self.pty.read_loop(self._on_pty_output))

    def attach_websocket(self, ws: WebSocket):
        self.websockets.add(ws)

    def detach_websocket(self, ws: WebSocket):
        if ws in self.websockets:
            self.websockets.remove(ws)

    async def execute_command(self, command: str, timeout_seconds: int = 30, broadcast: bool = True) -> dict:
        """Execute a command via the PTY using markers and capture the output.
        
        Args:
            command: The shell command to execute.
            timeout_seconds: Max time to wait for completion.
            broadcast: If True (cmd mode), output is sent to UI websockets.
                       If False (agent mode), output is only captured, not broadcast.
        """
        if self.is_executing_command:
            raise Exception("A command is already executing in this session")
            
        self.is_executing_command = True
        self._current_broadcast = broadcast
        self.command_output_buffer = ""
        self.command_future = asyncio.get_event_loop().create_future()
        
        marker = f"__OPSINTECH_MARKER_{uuid.uuid4().hex}__"
        self.end_marker = f"{marker}_END"
        
        # Write the command exactly as it is so it looks native to the user.
        # Use a clean marker format that won't leave residuals after stripping
        full_command = f"{command}\necho {self.end_marker}$?\n"
        self.pty.write(full_command)
        
        try:
            output = await asyncio.wait_for(self.command_future, timeout=timeout_seconds)
            
            # Parse output between markers
            start_idx = output.find(f"{marker}_START")
            if start_idx != -1:
                start_line_end = output.find("\n", start_idx)
                if start_line_end != -1:
                    output = output[start_line_end+1:]
            
            end_idx = output.find(self.end_marker)
            exit_code = 0
            if end_idx != -1:
                import re
                end_str = output[end_idx:]
                # Match: MARKER_END<NUMBER> (space between marker and exit code)
                match = re.search(f"{re.escape(self.end_marker)}(\\d+)", end_str)
                if match:
                    exit_code = int(match.group(1))
                output = output[:end_idx].rstrip()

            # Clean the output string to remove any marker echoes
            output = re.sub(r'.*__OPSINTECH_MARKER_.*(\r\n|\n)?', '', output).strip()

            # Strip ANSI escape sequences (color codes, cursor movements, etc.)
            ansi_escape = re.compile(r'\x1b\[[0-9;]*[a-zA-Z]|\x1b\][0-9;]*[a-zA-Z]|\x1b[()][0-9AB]|\x1b\[[?][0-9;]*[hl]')
            output = ansi_escape.sub('', output)

            return {
                "stdout": output,
                "stderr": "", # PTY merges stdout and stderr
                "return_code": exit_code
            }
        except TimeoutError:
            # Need to send Ctrl+C to cancel command
            self.pty.write("\x03")
            return {
                "stdout": self.command_output_buffer,
                "stderr": f"Command timed out after {timeout_seconds} seconds",
                "return_code": -1
            }
        finally:
            self.is_executing_command = False
            self.command_future = None

    def close(self):
        self.pty.close()
        if self.read_task:
            self.read_task.cancel()
        for f in self.temp_files:
            try:
                os.remove(f)
            except OSError:
                pass


TerminalSessionKey = tuple[str, str, str, str]


class TerminalSessionManager:
    """Holds the live PTY sessions, keyed by the caller that owns them.

    A session here is a logged-in shell on a production host, so the key has to
    say whose it is. ``session_id`` is the browser's taskId: the client picks the
    value, so two callers can present the same one. Keying on it alone handed
    them a single shared shell, and the prefix scan that used to back
    ``get_session`` let a short or guessed id resolve onto a stranger's session.

    The key now carries the authenticated tenant and user, which every caller
    resolves server-side — the same identity triple
    ``app.gateway.routers.terminal._graph_thread_id`` derives the LangGraph
    thread id from, so the two keys cannot disagree about who owns a session.
    Reaching another caller's PTY is impossible rather than merely checked:
    there is no argument the client controls that reaches the tenant/user part
    of the key.

    The key is a tuple rather than a joined string, so a crafted ``session_id``
    has no separator to smuggle in and no key can be a prefix of another.
    """

    def __init__(self):
        self.sessions: dict[TerminalSessionKey, TerminalSession] = {}

    def _get_key(self, tenant_id: str, user_id: str, session_id: str, asset_id: str) -> TerminalSessionKey:
        # A blank tenant or user would put every caller that failed to resolve
        # its identity into one shared namespace, which is the hole this key
        # closes. Fail loudly instead.
        if not tenant_id or not user_id:
            raise ValueError("A terminal session needs an authenticated tenant_id and user_id")
        if not session_id or not asset_id:
            raise ValueError("A terminal session needs a session_id and an asset_id")
        return (tenant_id, user_id, session_id, asset_id)

    def get_or_create_session(self, tenant_id: str, user_id: str, session_id: str, asset_id: str) -> TerminalSession:
        key = self._get_key(tenant_id, user_id, session_id, asset_id)
        if key not in self.sessions:
            session = TerminalSession(session_id, asset_id, tenant_id=tenant_id, user_id=user_id)
            self.sessions[key] = session
        return self.sessions[key]

    def get_session(self, tenant_id: str, user_id: str, session_id: str, asset_id: str) -> TerminalSession | None:
        """Look up one of the caller's own sessions. Exact match, no scan."""
        return self.sessions.get(self._get_key(tenant_id, user_id, session_id, asset_id))

    def close_session(self, tenant_id: str, user_id: str, session_id: str, asset_id: str | None = None):
        """Close one session, or every session the caller holds for ``session_id``.

        With no ``asset_id`` this still spans hosts — a task can be attached to
        several — but only within the caller's own namespace, by comparing the
        key fields, never by matching a prefix across the whole dict.
        """
        if asset_id:
            key = self._get_key(tenant_id, user_id, session_id, asset_id)
            keys_to_close = [key] if key in self.sessions else []
        else:
            if not tenant_id or not user_id or not session_id:
                raise ValueError("A terminal session needs an authenticated tenant_id and user_id")
            keys_to_close = [
                k for k in self.sessions
                if k[0] == tenant_id and k[1] == user_id and k[2] == session_id
            ]
        for key in keys_to_close:
            self.sessions[key].close()
            del self.sessions[key]

session_manager = TerminalSessionManager()
