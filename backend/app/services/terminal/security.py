import re
import shlex
from typing import Literal, Any, List, Dict

from app.gateway.i18n import tr

SecurityResult = Literal["allow", "ask", "block"]

class CommandSecurityResult:
    def __init__(
        self,
        action: SecurityResult,
        reason: str = "",
        risk_level: str = "low",
        is_state_changing: bool = False,
    ):
        self.action = action
        self.reason = reason
        self.risk_level = risk_level
        self.is_state_changing = is_state_changing


DEFAULT_SECURITY_CONFIG = {
    "enableCommandSecurity": True,
    "enableStrictMode": False,
    "maxCommandLength": 10000,
    "blacklistPatterns": [
        'rm -rf /',
        'rm -rf /*',
        'rm -fr /',
        'rm -fr /*',
        'chmod 777 /',
        'chmod -R 777 /',
        'chown -R /',
        'dd if=/dev/zero',
        'mkfs.* /dev/sda',
        'mkfs.* /dev/nvme',
        ':(){ :|:& };:',
        'wget * -O - | sh',
        'curl * | sh',
    ],
    "whitelistPatterns": [
        'ls', 'pwd', 'whoami', 'date', 'uptime', 'uname',
        'df', 'du', 'free', 'ps aux', 'top -n 1 -b',
        'netstat', 'ss', 'ping', 'curl -I', 'wget --spider',
        'cat', 'head', 'tail', 'grep', 'find', 'which', 'type', 'file',
        'echo', 'printf', 'printenv', 'env',
        'id', 'groups', 'hostname',
        'awk', 'sed', 'cut', 'tr',
        'git status', 'git log', 'git diff', 'git branch',
        'docker ps', 'docker images', 'kubectl get',
        'journalctl', 'dmesg',
    ],
    "dangerousCommands": [
        'rm', 'del', 'format', 'shutdown', 'reboot', 'halt', 'poweroff',
        'dd', 'mkfs', 'fdisk', 'parted',
        'killall', 'pkill',
        'systemctl', 'service',
        'chmod', 'chown',
        'mount', 'umount',
        'iptables', 'ufw', 'firewall-cmd',
        'sudo', 'su',
        'init',
    ],
    "securityPolicy": {
        "blockCritical": True,
        "askForHigh": True,
        "askForMedium": True,
        "askForBlacklist": False,
    },
}

DEFAULT_AUTO_APPROVAL = {
    "enabled": False,
    "actions": {
        "readFiles": True,
        "editFiles": False,
        "executeSafeCommands": True,
        "executeAllCommands": False,
        "autoExecuteReadOnlyCommands": False,
    },
    "maxRequests": 3,
    "enableNotifications": True,
}

# Keys the tenant policy may pin, and the direction each one is combined in.
# A tenant pin is a ceiling: the member may only move the effective value in the
# stricter direction, never the looser one.
TENANT_UNION_KEYS = ("blacklistPatterns", "dangerousCommands")
TENANT_INTERSECTION_KEYS = ("whitelistPatterns",)
TENANT_OR_KEYS = ("enableCommandSecurity", "enableStrictMode")
TENANT_MIN_KEYS = ("maxCommandLength",)
TENANT_NESTED_PIN_KEYS = ("securityPolicy",)
TENANT_AUTO_APPROVAL_MIN_KEYS = ("maxRequests",)


def _as_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _union(tenant_items: Any, user_items: Any) -> list:
    merged = list(_as_list(tenant_items))
    seen = set(merged)
    for item in _as_list(user_items):
        if item not in seen:
            merged.append(item)
            seen.add(item)
    return merged


def _intersection(tenant_items: Any, user_items: Any) -> list:
    allowed = set(_as_list(user_items))
    return [item for item in _as_list(tenant_items) if item in allowed]


def _stricter_min(tenant_value: Any, user_value: Any) -> Any:
    if isinstance(tenant_value, (int, float)) and isinstance(user_value, (int, float)):
        return min(tenant_value, user_value)
    return tenant_value


def _merge_over_defaults(defaults: dict, user: dict, nested_key: str) -> dict:
    merged = {
        key: list(value) if isinstance(value, list) else value
        for key, value in {**defaults, **user}.items()
    }
    merged[nested_key] = {
        **_as_dict(defaults.get(nested_key)),
        **_as_dict(user.get(nested_key)),
    }
    return merged


def _combine_security_key(key: str, tenant_value: Any, user_value: Any) -> Any:
    if key in TENANT_UNION_KEYS:
        return _union(tenant_value, user_value)
    if key in TENANT_INTERSECTION_KEYS:
        return _intersection(tenant_value, user_value)
    if key in TENANT_OR_KEYS:
        return bool(tenant_value) or bool(user_value)
    if key in TENANT_MIN_KEYS:
        return _stricter_min(tenant_value, user_value)
    if key in TENANT_NESTED_PIN_KEYS:
        return {**_as_dict(user_value), **_as_dict(tenant_value)}
    return tenant_value


def _combine_auto_approval_key(key: str, tenant_value: Any, user_value: Any) -> Any:
    if key == "enabled":
        return bool(tenant_value) and bool(user_value)
    if key == "actions":
        user_actions = _as_dict(user_value)
        actions = dict(user_actions)
        for action, pinned in _as_dict(tenant_value).items():
            if action in user_actions:
                actions[action] = bool(pinned) and bool(user_actions[action])
            else:
                actions[action] = bool(pinned)
        return actions
    if key in TENANT_AUTO_APPROVAL_MIN_KEYS:
        return _stricter_min(tenant_value, user_value)
    return tenant_value


def resolve_effective_policy(tenant_policy: dict, user_settings: dict) -> tuple[dict, dict]:
    """Resolve the policy actually enforced for one member of one tenant.

    Both arguments are the raw stored config blobs, shaped
    ``{"security_config": {...}, "auto_approval": {...}}`` — ``tenant_policy``
    from ``tenant_terminal_policies.config``, ``user_settings`` from
    ``terminal_security_settings.config``.

    The user value is first merged over the platform defaults, which is exactly
    what the call sites used to do on their own. Every key the tenant pins is
    then combined with that value in the stricter direction; keys the tenant
    leaves out keep the user value, or the default when the user has none. An
    empty ``tenant_policy`` therefore reproduces the pre-policy behaviour.
    """
    tenant_policy = _as_dict(tenant_policy)
    user_settings = _as_dict(user_settings)

    security_config = _merge_over_defaults(
        DEFAULT_SECURITY_CONFIG,
        _as_dict(user_settings.get("security_config")),
        "securityPolicy",
    )
    auto_approval = _merge_over_defaults(
        DEFAULT_AUTO_APPROVAL,
        _as_dict(user_settings.get("auto_approval")),
        "actions",
    )

    for key, tenant_value in _as_dict(tenant_policy.get("security_config")).items():
        security_config[key] = _combine_security_key(
            key, tenant_value, security_config.get(key)
        )

    for key, tenant_value in _as_dict(tenant_policy.get("auto_approval")).items():
        auto_approval[key] = _combine_auto_approval_key(
            key, tenant_value, auto_approval.get(key)
        )

    return security_config, auto_approval


# The rationale shown to the user is stored as a (zh, en, vi) triple and
# resolved through tr() at evaluation time. Calling tr() here would freeze the
# language at import time, when no request locale exists yet.
DANGEROUS_COMMANDS_SEVERITY = {
    # Critical
    "rm": {"severity": "critical", "reason": (
        "删除文件/目录，可能导致数据丢失",
        "Deletes files/directories and may cause data loss",
        "Xóa tệp/thư mục, có thể gây mất dữ liệu",
    )},
    "del": {"severity": "critical", "reason": (
        "删除文件，可能导致数据丢失",
        "Deletes files and may cause data loss",
        "Xóa tệp, có thể gây mất dữ liệu",
    )},
    "format": {"severity": "critical", "reason": (
        "格式化磁盘，会导致数据永久丢失",
        "Formats disk and causes permanent data loss",
        "Định dạng ổ đĩa, sẽ gây mất dữ liệu vĩnh viễn",
    )},
    "shutdown": {"severity": "critical", "reason": (
        "关闭系统，会导致服务中断",
        "Shuts down the system and interrupts services",
        "Tắt hệ thống, sẽ làm gián đoạn dịch vụ",
    )},
    "reboot": {"severity": "critical", "reason": (
        "重启系统，会导致服务中断",
        "Reboots the system and interrupts services",
        "Khởi động lại hệ thống, sẽ làm gián đoạn dịch vụ",
    )},
    "halt": {"severity": "critical", "reason": (
        "停止系统，会导致服务中断",
        "Halts the system and interrupts services",
        "Dừng hệ thống, sẽ làm gián đoạn dịch vụ",
    )},
    "poweroff": {"severity": "critical", "reason": (
        "关闭电源，会导致服务中断",
        "Powers off the system and interrupts services",
        "Tắt nguồn hệ thống, sẽ làm gián đoạn dịch vụ",
    )},
    "dd": {"severity": "critical", "reason": (
        "磁盘操作，误用会导致数据丢失",
        "Low-level disk operation; misuse may cause data loss",
        "Thao tác ổ đĩa cấp thấp; dùng sai có thể gây mất dữ liệu",
    )},
    "mkfs": {"severity": "critical", "reason": (
        "创建文件系统，会清空磁盘数据",
        "Creates a filesystem and erases disk data",
        "Tạo hệ thống tệp, sẽ xóa sạch dữ liệu ổ đĩa",
    )},
    "fdisk": {"severity": "critical", "reason": (
        "磁盘分区操作，误用会导致数据丢失",
        "Disk partitioning operation; misuse may cause data loss",
        "Thao tác phân vùng ổ đĩa; dùng sai có thể gây mất dữ liệu",
    )},
    "parted": {"severity": "critical", "reason": (
        "磁盘分区工具，误操作会导致数据丢失",
        "Disk partitioning tool; misuse may cause data loss",
        "Công cụ phân vùng ổ đĩa; thao tác sai có thể gây mất dữ liệu",
    )},
    "init": {"severity": "critical", "reason": (
        "改变系统运行级别，可能导致服务中断",
        "Changes system runlevel and may interrupt services",
        "Thay đổi runlevel hệ thống, có thể làm gián đoạn dịch vụ",
    )},
    # High
    "killall": {"severity": "high", "reason": (
        "批量终止进程，可能影响系统稳定性",
        "Terminates processes in bulk; may affect system stability",
        "Kết thúc hàng loạt tiến trình, có thể ảnh hưởng ổn định hệ thống",
    )},
    "pkill": {"severity": "high", "reason": (
        "模式匹配终止进程，可能误杀关键进程",
        "Kills processes by pattern; may terminate critical processes",
        "Kết thúc tiến trình theo mẫu, có thể dừng nhầm tiến trình quan trọng",
    )},
    "systemctl": {"severity": "high", "reason": (
        "管理系统服务，可能影响服务运行",
        "Manages system services; may affect running services",
        "Quản lý dịch vụ hệ thống, có thể ảnh hưởng hoạt động dịch vụ",
    )},
    "service": {"severity": "high", "reason": (
        "管理系统服务，可能影响服务运行",
        "Manages system services; may affect running services",
        "Quản lý dịch vụ hệ thống, có thể ảnh hưởng hoạt động dịch vụ",
    )},
    "chmod": {"severity": "high", "reason": (
        "修改文件权限，可能导致安全漏洞",
        "Modifies file permissions; may introduce security risks",
        "Thay đổi quyền tệp, có thể gây lỗ hổng bảo mật",
    )},
    "chown": {"severity": "high", "reason": (
        "修改文件所有者，可能影响系统安全",
        "Changes file ownership; may affect system security",
        "Thay đổi chủ sở hữu tệp, có thể ảnh hưởng bảo mật hệ thống",
    )},
    "mount": {"severity": "high", "reason": (
        "挂载文件系统，不当操作可能影响系统",
        "Mounts a filesystem; improper use may affect the system",
        "Gắn kết hệ thống tệp; thao tác sai có thể ảnh hưởng hệ thống",
    )},
    "umount": {"severity": "high", "reason": (
        "卸载文件系统，可能导致数据不一致",
        "Unmounts a filesystem; may cause data inconsistency",
        "Tháo gắn kết hệ thống tệp, có thể gây mất nhất quán dữ liệu",
    )},
    # Medium
    "iptables": {"severity": "medium", "reason": (
        "修改防火墙规则，可能影响网络访问",
        "Modifies firewall rules; may affect network access",
        "Thay đổi quy tắc tường lửa, có thể ảnh hưởng truy cập mạng",
    )},
    "ufw": {"severity": "medium", "reason": (
        "修改防火墙设置，可能影响网络访问",
        "Modifies firewall settings; may affect network access",
        "Thay đổi cài đặt tường lửa, có thể ảnh hưởng truy cập mạng",
    )},
    "firewall-cmd": {"severity": "medium", "reason": (
        "修改防火墙配置，可能影响网络访问",
        "Modifies firewall configuration; may affect network access",
        "Thay đổi cấu hình tường lửa, có thể ảnh hưởng truy cập mạng",
    )},
    "sudo": {"severity": "medium", "reason": (
        "以超级用户权限执行命令，请确认必要性",
        "Executes command with superuser privileges; please confirm necessity",
        "Thực thi lệnh với quyền siêu người dùng, vui lòng xác nhận sự cần thiết",
    )},
    "su": {"severity": "medium", "reason": (
        "切换用户身份，请确认必要性",
        "Switches user identity; please confirm necessity",
        "Chuyển đổi danh tính người dùng, vui lòng xác nhận sự cần thiết",
    )},
}

_GENERIC_DANGEROUS_REASON = (
    "高风险命令",
    "High-risk command",
    "Lệnh rủi ro cao",
)


def _dangerous_reason(reason: Any) -> str:
    """Resolve a dangerous-command rationale for the caller's locale."""
    if isinstance(reason, (tuple, list)) and len(reason) == 3:
        return tr(*reason)
    # A tenant-supplied override is already a plain string.
    return str(reason)

READONLY_COMMANDS = [
    'ls', 'pwd', 'whoami', 'date', 'uptime', 'uname',
    'df', 'du', 'free', 'ps', 'top', 'htop',
    'netstat', 'ss', 'ping', 'traceroute',
    'curl', 'wget',
    'cat', 'head', 'tail', 'grep', 'find', 'wc', 'sort',
    'which', 'whereis', 'type', 'file',
    'echo', 'printf', 'printenv', 'env',
    'history', 'alias', 'help', 'man', 'info',
    'id', 'groups', 'hostname', 'hostnamectl',
    'awk', 'sed', 'cut', 'tr',
    'git status', 'git log', 'git diff', 'git branch', 'git show',
    'docker ps', 'docker images', 'docker logs', 'docker inspect',
    'kubectl get', 'kubectl describe', 'kubectl logs',
    'journalctl', 'dmesg',
    'systemctl status', 'systemctl list-units',
]

def split_compound_command(command: str) -> List[str]:
    parts = []
    current = []
    in_single = False
    in_double = False
    i = 0
    n = len(command)
    while i < n:
        ch = command[i]
        if ch == "'" and not in_double:
            in_single = not in_single
            current.append(ch)
        elif ch == '"' and not in_single:
            in_double = not in_double
            current.append(ch)
        elif not in_single and not in_double:
            if ch == '&' and i + 1 < n and command[i+1] == '&':
                parts.append("".join(current).strip())
                current = []
                i += 1
            elif ch == '|' and i + 1 < n and command[i+1] == '|':
                parts.append("".join(current).strip())
                current = []
                i += 1
            elif ch == ';':
                parts.append("".join(current).strip())
                current = []
            else:
                current.append(ch)
        else:
            current.append(ch)
        i += 1
    if current:
        parts.append("".join(current).strip())
    return [p for p in parts if p]

def extract_executable(command: str) -> str:
    prefixes = ["sudo", "timeout", "nice", "ionice", "nohup", "setsid", "chroot", "flock", "stdbuf"]
    stripped = command.strip()
    while True:
        words = stripped.split()
        if not words:
            break
        if words[0] in prefixes:
            stripped = stripped[len(words[0]):].strip()
        else:
            break

    pipe_idx = -1
    in_single = False
    in_double = False
    for idx, ch in enumerate(stripped):
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif ch == '|' and not in_single and not in_double:
            pipe_idx = idx
            break

    first_cmd = stripped[:pipe_idx].strip() if pipe_idx >= 0 else stripped
    match = re.match(r"^([a-zA-Z0-9_][a-zA-Z0-9_.-]*)", first_cmd)
    return match.group(1) if match else ""

def matches_pattern(command: str, pattern: str) -> bool:
    command_lower = command.lower().strip()
    pattern_lower = pattern.lower().strip()

    if "*" in pattern_lower:
        escaped = re.escape(pattern_lower).replace(r"\*", ".*")
        return bool(re.match(f"^{escaped}$", command_lower))

    escaped_pattern = re.escape(pattern_lower)
    if pattern_lower.endswith(" /") or pattern_lower.endswith(" / "):
        return bool(re.search(f"^{escaped_pattern}(\\s|$)", command_lower))

    return bool(re.search(f"(^|\\s){escaped_pattern}(\\s|$)", command_lower))

def is_read_only_command(command: str) -> bool:
    lower = command.lower().strip()
    return any(lower.startswith(c) for c in READONLY_COMMANDS)


class CommandSecurityService:
    @classmethod
    def evaluate_command(
        cls,
        command: str,
        mode: str = "agent",
        security_config: dict = None,
        auto_approval: dict = None,
    ) -> CommandSecurityResult:
        """
        Evaluate a shell command dynamically and return action/reason.
        """
        if security_config is None:
            security_config = DEFAULT_SECURITY_CONFIG
        if auto_approval is None:
            auto_approval = DEFAULT_AUTO_APPROVAL

        command = command.strip()
        if not command:
            return CommandSecurityResult(
                "allow",
                tr("空命令", "Empty command", "Lệnh trống"),
            )

        enable_command_security = security_config.get("enableCommandSecurity", True)
        if not enable_command_security:
            return CommandSecurityResult(
                "allow",
                tr(
                    "安全检查已关闭",
                    "Security checks are disabled",
                    "Kiểm tra an toàn đã bị tắt",
                ),
            )

        # Length check
        max_length = security_config.get("maxCommandLength", 10000)
        if len(command) > max_length:
            return CommandSecurityResult(
                "block",
                tr(
                    f"命令长度超过限制 ({max_length} 字符)",
                    f"Command length exceeds limit ({max_length} characters)",
                    f"Độ dài lệnh vượt quá giới hạn ({max_length} ký tự)",
                ),
                risk_level="medium",
                is_state_changing=False,
            )

        compounds = split_compound_command(command)

        # 1. Blacklist check
        blacklist_patterns = security_config.get("blacklistPatterns", [])
        for cmd in compounds:
            for pattern in blacklist_patterns:
                if matches_pattern(cmd, pattern):
                    ask_for_blacklist = security_config.get("securityPolicy", {}).get("askForBlacklist", False)
                    if ask_for_blacklist:
                        return CommandSecurityResult(
                            "ask",
                            tr(
                                f"命令命中了黑名单模式 '{pattern}'，策略已配置为人工确认。",
                                f"Command matches blacklist pattern '{pattern}'; the policy requires manual confirmation.",
                                f"Lệnh khớp mẫu danh sách đen '{pattern}'; chính sách yêu cầu xác nhận thủ công.",
                            ),
                            risk_level="critical",
                            is_state_changing=True,
                        )
                    else:
                        return CommandSecurityResult(
                            "block",
                            tr(
                                f"命令命中了阻断规则 '{pattern}'，已拦截该操作。",
                                f"Command matches blocking rule '{pattern}'; the operation was blocked.",
                                f"Lệnh khớp quy tắc chặn '{pattern}'; thao tác đã bị chặn.",
                            ),
                            risk_level="critical",
                            is_state_changing=True,
                        )

        # 2. Strict Mode Whitelist check
        enable_strict_mode = security_config.get("enableStrictMode", False)
        if enable_strict_mode:
            whitelist_patterns = security_config.get("whitelistPatterns", [])
            for cmd in compounds:
                exec_name = extract_executable(cmd)
                if not exec_name:
                    continue
                is_whitelisted = False
                for p in whitelist_patterns:
                    if matches_pattern(cmd, p) or exec_name.lower() == p.lower().split()[0]:
                        is_whitelisted = True
                        break
                if not is_whitelisted:
                    return CommandSecurityResult(
                        "block",
                        tr(
                            f"严格模式下禁止执行非白名单命令 '{exec_name}'。",
                            f"Command '{exec_name}' is not in the whitelist (strict mode enabled).",
                            f"Lệnh '{exec_name}' không nằm trong danh sách cho phép (đã bật chế độ nghiêm ngặt).",
                        ),
                        risk_level="medium",
                        is_state_changing=True,
                    )

        # 3. Dangerous command list check
        dangerous_commands = security_config.get("dangerousCommands", [])
        policy = security_config.get("securityPolicy", {})
        for cmd in compounds:
            exec_name = extract_executable(cmd).lower()
            if not exec_name:
                continue
            if exec_name in dangerous_commands or exec_name in DANGEROUS_COMMANDS_SEVERITY:
                info = DANGEROUS_COMMANDS_SEVERITY.get(
                    exec_name,
                    {"severity": "medium", "reason": _GENERIC_DANGEROUS_REASON},
                )
                severity = info["severity"]
                reason = _dangerous_reason(info["reason"])

                # Check policy
                should_ask = True
                if severity == "critical":
                    should_ask = not policy.get("blockCritical", True)
                elif severity == "high":
                    should_ask = policy.get("askForHigh", True)
                elif severity == "medium":
                    should_ask = policy.get("askForMedium", True)

                if not should_ask:
                    return CommandSecurityResult(
                        "block",
                        tr(
                            f"命令 '{exec_name}' 属于高风险操作（{reason}），安全策略已配置为禁止执行。",
                            f"Command '{exec_name}' is a high-risk operation ({reason}); the security policy forbids running it.",
                            f"Lệnh '{exec_name}' là thao tác rủi ro cao ({reason}); chính sách an toàn không cho phép thực thi.",
                        ),
                        risk_level=severity,
                        is_state_changing=True,
                    )
                else:
                    # Check if auto-approval override applies
                    if mode == "agent" and auto_approval.get("enabled", False):
                        if auto_approval.get("actions", {}).get("executeAllCommands", False):
                            continue

                    return CommandSecurityResult(
                        "ask",
                        tr(
                            f"检测到高风险命令 '{exec_name}'（{reason}），需要人工确认。",
                            f"High-risk command '{exec_name}' detected ({reason}); manual confirmation is required.",
                            f"Phát hiện lệnh rủi ro cao '{exec_name}' ({reason}); cần xác nhận thủ công.",
                        ),
                        risk_level=severity,
                        is_state_changing=True,
                    )

        # 4. Standard auto-approval for safe commands
        if mode == "agent" and auto_approval.get("enabled", False):
            all_readonly = True
            for cmd in compounds:
                if not is_read_only_command(cmd):
                    all_readonly = False
                    break

            if all_readonly:
                if auto_approval.get("actions", {}).get("executeSafeCommands", True):
                    return CommandSecurityResult(
                        "allow",
                        tr(
                            "命令属于安全只读操作，已自动批准执行。",
                            "Command is a safe read-only operation and was auto-approved.",
                            "Lệnh là thao tác chỉ đọc an toàn và đã được tự động phê duyệt.",
                        ),
                    )
            else:
                if auto_approval.get("actions", {}).get("editFiles", False):
                    return CommandSecurityResult(
                        "allow",
                        tr(
                            "自动执行写操作命令。",
                            "Write command executed automatically.",
                            "Lệnh ghi được thực thi tự động.",
                        ),
                    )
                else:
                    return CommandSecurityResult(
                        "ask",
                        tr(
                            "命令包含写操作或修改状态，需用户授权。",
                            "Command writes or changes state and needs your authorization.",
                            "Lệnh có ghi dữ liệu hoặc thay đổi trạng thái, cần bạn cho phép.",
                        ),
                        risk_level="medium",
                        is_state_changing=True,
                    )

        # In cmd mode, everything not blocked requires confirmation
        if mode == "cmd":
            # Determine risk level based on executable
            has_state_changing = False
            for cmd in compounds:
                exec_name = extract_executable(cmd).lower()
                if exec_name in DANGEROUS_COMMANDS_SEVERITY:
                    has_state_changing = True
                    break

            return CommandSecurityResult(
                "ask",
                tr(
                    "Command 模式下所有命令均需手动确认。",
                    "In Command mode every command requires manual confirmation.",
                    "Ở chế độ Command, mọi lệnh đều cần xác nhận thủ công.",
                ),
                risk_level="medium" if has_state_changing else "low",
                is_state_changing=has_state_changing,
            )

        return CommandSecurityResult(
            "allow",
            tr(
                "命令安全，由 Agent 自动执行。",
                "Command is safe; the Agent runs it automatically.",
                "Lệnh an toàn; Agent tự động thực thi.",
            ),
        )


security_service = CommandSecurityService()

