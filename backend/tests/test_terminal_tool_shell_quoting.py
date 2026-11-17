"""Arguments the model chooses must not be able to inject shell on a remote host.

``read_file``, ``write_file``, ``grep_search`` and ``web_fetch`` build a shell
command string and hand it to ``_execute_cmd_raw``, which runs it over SSH on a
production host and does NOT pass through ``security_service.evaluate_command``.
So the command-approval ceiling never sees these.

Their arguments are picked by the LLM, and the LLM reads untrusted text --
file contents, fetched pages, alert payloads. A single quote in an argument was
enough to close the quoting and append commands. ``shlex.quote`` is the fix;
these tests are what keeps it there.
"""

from __future__ import annotations

import asyncio
import shlex
from typing import Any

import pytest

from app.agent import terminal_tools

#: Closes the quoting, runs a command, then reopens it so the rest still parses.
INJECTION = "x'; touch /tmp/pwned; echo '"

#: Shell metacharacters that must all stay inert.
PAYLOADS = [
    INJECTION,
    "a; rm -rf /",
    "a && id",
    "a | tee /tmp/x",
    "a $(id)",
    "a `id`",
    "a\nid",
    "a > /tmp/x",
]


class _FakeSession:
    def __init__(self, sink: list[str]) -> None:
        self._sink = sink

    async def execute_command(self, command: str, broadcast: bool = False) -> dict[str, Any]:
        self._sink.append(command)
        return {"return_code": 0, "stdout": "", "stderr": ""}


@pytest.fixture
def captured(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Run a tool's operation against a fake session and capture the shell string."""
    sink: list[str] = []

    async def fake_run_on_targets(op, host_index: int) -> str:
        return await op(_FakeSession(sink))

    monkeypatch.setattr(terminal_tools, "_run_on_targets", fake_run_on_targets)
    return sink


def _tokens(command: str) -> list[str]:
    return shlex.split(command)


@pytest.mark.parametrize("payload", PAYLOADS)
def test_read_file_quotes_the_path(captured: list[str], payload: str) -> None:
    asyncio.run(terminal_tools.read_file.ainvoke({"path": payload}))
    assert len(captured) == 1
    # The payload survives as exactly one argv token: nothing escaped the quoting.
    assert payload in _tokens(captured[0])


@pytest.mark.parametrize("payload", PAYLOADS)
def test_grep_search_quotes_pattern_and_path(captured: list[str], payload: str) -> None:
    asyncio.run(terminal_tools.grep_search.ainvoke({"pattern": payload, "path": payload}))
    assert _tokens(captured[0]).count(payload) == 2


@pytest.mark.parametrize("payload", PAYLOADS)
def test_web_fetch_quotes_the_url(captured: list[str], payload: str) -> None:
    url = f"http://example.com/{payload}"
    result = asyncio.run(terminal_tools.web_fetch.ainvoke({"url": url}))
    assert "must start with http" not in result
    assert url in _tokens(captured[0])


def test_write_file_quotes_the_path(captured: list[str]) -> None:
    asyncio.run(terminal_tools.write_file.ainvoke({"path": INJECTION, "content": "hello"}))
    heredoc_header = captured[0].split("<<", 1)[0]
    assert INJECTION in _tokens(heredoc_header)


def test_write_file_does_not_mangle_quotes_in_content(captured: list[str]) -> None:
    """A quoted heredoc delimiter makes the body literal, so content goes verbatim."""
    content = "it's a \"test\" with 'quotes'"
    asyncio.run(terminal_tools.write_file.ainvoke({"path": "/tmp/f", "content": content}))
    body = captured[0].split("OPSINTECH_EOF'\n", 1)[1].rsplit("\nOPSINTECH_EOF", 1)[0]
    assert body == content
    assert "'\\''" not in body


def test_numeric_limits_are_coerced(captured: list[str]) -> None:
    """max_lines and friends land in the command unquoted, so they must be ints."""
    asyncio.run(terminal_tools.read_file.ainvoke({"path": "/tmp/f", "max_lines": "50"}))
    assert captured[0].endswith("head -n 50")
