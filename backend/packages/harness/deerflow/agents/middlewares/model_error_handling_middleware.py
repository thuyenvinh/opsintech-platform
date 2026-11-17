"""Model error handling middleware that catches LLM call exceptions and converts them to user-friendly AIMessages.

This prevents graph-level failures that would otherwise result in generic
"Internal error" messages on the frontend. Instead, the error is surfaced as
an AI message in the conversation, allowing the user to understand what went
wrong and potentially retry.

When a context_length_exceeded error is detected, the middleware automatically
instructs the agent to summarize the conversation and retry, instead of just
reporting the error.
"""

import logging
import re
from collections.abc import Awaitable, Callable
from typing import override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelCallResult, ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langgraph.errors import GraphBubbleUp

logger = logging.getLogger(__name__)

CONTEXT_BUDGET_WARN_RATIO = 0.8


def _estimate_message_tokens(messages: list[BaseMessage] | None) -> int:
    if not messages:
        return 0
    try:
        from deerflow.agents.memory.prompt import _count_tokens
    except ImportError:
        return 0
    total = 0
    for msg in messages:
        if isinstance(msg.content, str):
            total += _count_tokens(msg.content)
        elif isinstance(msg.content, list):
            for part in msg.content:
                if isinstance(part, dict) and "text" in part:
                    total += _count_tokens(str(part["text"]))
    return total


_VI_CHAR_RE = re.compile(
    r"[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđĐ]",
    re.IGNORECASE,
)
_ZH_CHAR_RE = re.compile(r"[\u4e00-\u9fff]")

_ERROR_MESSAGES: dict[str, dict[str, str]] = {
    "vi": {
        "rate_limit_429": "Yêu cầu mô hình bị giới hạn tốc độ (429), vui lòng thử lại sau. Nếu sự cố vẫn tiếp diễn, hãy cân nhắc sử dụng mô hình khác.",
        "rate_limit": "Yêu cầu mô hình bị giới hạn tốc độ, vui lòng thử lại sau.",
        "auth_error": "Xác thực mô hình thất bại (401), vui lòng kiểm tra lại cấu hình khóa API.",
        "context_length_bad_request": (
            "Nội dung đầu vào quá dài, vượt quá giới hạn ngữ cảnh của mô hình. "
            "Hệ thống đã tự động kích hoạt tóm tắt hội thoại, vui lòng thử lại. "
            "Nếu sự cố vẫn tiếp diễn, khuyến nghị: 1) Giảm lượng nội dung trong mỗi yêu cầu "
            "2) Lưu tài liệu dài thành tệp và tham chiếu đường dẫn 3) Sử dụng mô hình có cửa sổ ngữ cảnh lớn hơn."
        ),
        "model_unavailable_named": "Mô hình được yêu cầu không khả dụng: {detail}",
        "bad_request": "Tham số yêu cầu không hợp lệ: {detail}",
        "not_found": "Tài nguyên được yêu cầu không tồn tại: {detail}",
        "connection_error": "Không thể kết nối tới dịch vụ mô hình, vui lòng kiểm tra kết nối mạng hoặc thử lại sau.",
        "timeout_error": "Yêu cầu mô hình đã quá thời gian chờ, vui lòng thử lại sau.",
        "internal_server_error": "Lỗi nội bộ dịch vụ mô hình, vui lòng thử lại sau.",
        "invalid_null_choices": "Mô hình trả về phản hồi không hợp lệ (kết quả trống), vui lòng thử lại.",
        "quota_exhausted": "Hạn mức mô hình đã hết, vui lòng liên hệ quản trị viên hoặc sử dụng mô hình khác.",
        "insufficient_quota": "Hạn mức mô hình không đủ, vui lòng liên hệ quản trị viên.",
        "context_length_generic": (
            "Nội dung đầu vào quá dài, vượt quá giới hạn ngữ cảnh của mô hình. "
            "Hệ thống đã tự động kích hoạt tóm tắt hội thoại, vui lòng thử lại. "
            "Nếu sự cố vẫn tiếp diễn, hãy tham chiếu tài liệu dài qua đường dẫn tệp thay vì chèn trực tiếp nội dung."
        ),
        "no_model_specified": "Chưa chọn mô hình, vui lòng chọn một mô hình khả dụng trước.",
        "model_not_available": "Mô hình không khả dụng: {detail}",
        "generic_error": "Gọi mô hình thất bại ({exc_type}): {detail}",
    },
    "zh": {
        "rate_limit_429": "模型请求已限速（429），请稍后重试。如果问题持续，请考虑使用其他模型。",
        "rate_limit": "模型请求已限速，请稍后重试。",
        "auth_error": "模型认证失败（401），请检查 API 密钥配置是否正确。",
        "context_length_bad_request": (
            "输入内容过长，超出模型上下文限制。"
            "系统已自动触发对话摘要压缩，请重试。"
            "如果问题持续，建议：1) 减少单次请求的内容量 2) 将长文档保存为文件后引用路径 3) 使用更大 context 窗口的模型。"
        ),
        "model_unavailable_named": "请求的模型不可用：{detail}",
        "bad_request": "请求参数错误：{detail}",
        "not_found": "请求的资源不存在：{detail}",
        "connection_error": "无法连接到模型服务，请检查网络连接或稍后重试。",
        "timeout_error": "模型请求超时，请稍后重试。",
        "internal_server_error": "模型服务内部错误，请稍后重试。",
        "invalid_null_choices": "模型返回了无效响应（空结果），请重试。",
        "quota_exhausted": "模型配额已用尽，请联系管理员或使用其他模型。",
        "insufficient_quota": "模型配额不足，请联系管理员。",
        "context_length_generic": (
            "输入内容过长，超出模型上下文限制。"
            "系统已自动触发对话摘要压缩，请重试。"
            "如果问题持续，建议将长文档引用为文件路径而非内联内容。"
        ),
        "no_model_specified": "未选择模型，请先选择一个可用的模型。",
        "model_not_available": "模型不可用：{detail}",
        "generic_error": "模型调用失败（{exc_type}）：{detail}",
    },
    "en": {
        "rate_limit_429": "Model request rate limited (429), please try again later. If the issue persists, consider using another model.",
        "rate_limit": "Model request rate limited, please try again later.",
        "auth_error": "Model authentication failed (401), please check your API key configuration.",
        "context_length_bad_request": (
            "Input content is too long and exceeds the model's context limit. "
            "Conversation summarization has been triggered automatically, please try again. "
            "If the issue persists, consider: 1) Reducing the content size per request "
            "2) Saving long documents as files and referencing their paths 3) Using a model with a larger context window."
        ),
        "model_unavailable_named": "Requested model is unavailable: {detail}",
        "bad_request": "Invalid request parameters: {detail}",
        "not_found": "Requested resource not found: {detail}",
        "connection_error": "Unable to connect to the model service, please check your network connection or try again later.",
        "timeout_error": "Model request timed out, please try again later.",
        "internal_server_error": "Model service internal error, please try again later.",
        "invalid_null_choices": "Model returned an invalid response (empty result), please try again.",
        "quota_exhausted": "Model quota exhausted, please contact your administrator or use another model.",
        "insufficient_quota": "Insufficient model quota, please contact your administrator.",
        "context_length_generic": (
            "Input content is too long and exceeds the model's context limit. "
            "Conversation summarization has been triggered automatically, please try again. "
            "If the issue persists, consider referencing long documents as file paths instead of inline content."
        ),
        "no_model_specified": "No model selected, please select an available model first.",
        "model_not_available": "Model unavailable: {detail}",
        "generic_error": "Model call failed ({exc_type}): {detail}",
    },
}


def _detect_lang_from_messages(messages: list[BaseMessage] | None) -> str:
    """Detect user language ('vi', 'zh', or 'en') from the latest human message."""
    if not messages:
        return "vi"
    for msg in reversed(messages):
        if isinstance(msg, HumanMessage) or getattr(msg, "type", None) == "human":
            content = getattr(msg, "content", "")
            if isinstance(content, str):
                text = content
            elif isinstance(content, list):
                text = " ".join(
                    str(part["text"]) if isinstance(part, dict) and "text" in part else str(part)
                    for part in content
                )
            else:
                text = ""
            if text.strip():
                if _VI_CHAR_RE.search(text):
                    return "vi"
                if _ZH_CHAR_RE.search(text):
                    return "zh"
                return "en"
    return "vi"


def _classify_model_error(exc: Exception, lang: str = "vi") -> str:
    """Classify a model error and return a localized user-friendly message."""
    messages = _ERROR_MESSAGES.get(lang, _ERROR_MESSAGES["vi"])
    exc_type = type(exc).__name__
    exc_message = str(exc).strip()

    if exc_type == "RateLimitError" or "RateLimitError" in exc_type:
        if "429" in exc_message:
            return messages["rate_limit_429"]
        return messages["rate_limit"]

    if exc_type == "AuthenticationError" or "AuthenticationError" in exc_type:
        return messages["auth_error"]

    if exc_type == "BadRequestError" or "BadRequestError" in exc_type:
        if "context_length_exceeded" in exc_message or "max_tokens" in exc_message.lower():
            return messages["context_length_bad_request"]
        if "model" in exc_message.lower() and ("not found" in exc_message.lower() or "does not exist" in exc_message.lower()):
            return messages["model_unavailable_named"].format(detail=_safe_extract_model_name(exc_message))
        return messages["bad_request"].format(detail=_truncate(exc_message, 200))

    if exc_type == "NotFoundError" or "NotFoundError" in exc_type:
        return messages["not_found"].format(detail=_truncate(exc_message, 200))

    if exc_type == "APIConnectionError" or "APIConnectionError" in exc_type:
        return messages["connection_error"]

    if exc_type == "APITimeoutError" or "APITimeoutError" in exc_type:
        return messages["timeout_error"]

    if exc_type == "InternalServerError" or "InternalServerError" in exc_type:
        return messages["internal_server_error"]

    if exc_type == "TypeError" and "null" in exc_message and "choices" in exc_message:
        return messages["invalid_null_choices"]

    if "rate limit" in exc_message.lower() or "ratelimit" in exc_message.lower():
        return messages["rate_limit"]

    if "quota" in exc_message.lower():
        return messages["quota_exhausted"]

    if "insufficient_quota" in exc_message or "billing" in exc_message.lower():
        return messages["insufficient_quota"]

    if "context_length" in exc_message or "max context" in exc_message.lower():
        return messages["context_length_generic"]

    if "No model" in exc_message and "specified" in exc_message:
        return messages["no_model_specified"]

    if "model" in exc_message.lower() and ("not found" in exc_message.lower() or "not available" in exc_message.lower()):
        return messages["model_not_available"].format(detail=_truncate(exc_message, 200))

    return messages["generic_error"].format(exc_type=exc_type, detail=_truncate(exc_message, 200))


def _safe_extract_model_name(message: str) -> str:
    try:
        import re
        match = re.search(r"model['\"\s:]+([a-zA-Z0-9_/\-\.]+)", message, re.IGNORECASE)
        if match:
            return match.group(1)
    except Exception:
        pass
    return ""


def _truncate(text: str, max_len: int = 200) -> str:
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."


class ModelErrorHandlingMiddleware(AgentMiddleware[AgentState]):
    """Catch model call exceptions and convert them to user-friendly AIMessages.

    When the LLM call fails (rate limit, auth error, invalid response, etc.),
    this middleware intercepts the exception and returns an AIMessage describing
    the error. This prevents the graph from failing with a generic "Internal error"
    and instead surfaces the actual problem to the user.

    Consecutive errors are tracked. When the same error type repeats 3+ times
    consecutively, the middleware stops converting and re-raises the exception
    to terminate the agent loop (preventing infinite replanning).
    """

    _MAX_CONSECUTIVE_ERRORS = 3

    def __init__(self) -> None:
        super().__init__()
        self._consecutive_errors = 0

    def _handle_error(self, exc: Exception, lang: str = "vi") -> AIMessage:
        self._consecutive_errors += 1
        if self._consecutive_errors >= self._MAX_CONSECUTIVE_ERRORS:
            logger.error(
                "Model call failed %d times consecutively, re-raising to terminate agent loop: %s",
                self._consecutive_errors, exc,
            )
            raise

        user_message = _classify_model_error(exc, lang=lang)
        logger.exception(
            "Model call failed (attempt %d/%d), converting to error AIMessage: %s",
            self._consecutive_errors, self._MAX_CONSECUTIVE_ERRORS, user_message,
        )
        return AIMessage(content=f"⚠️ {user_message}")

    @override
    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelCallResult:
        messages = getattr(request, "messages", None)
        estimated_tokens = _estimate_message_tokens(messages)
        if estimated_tokens > 8000:
            logger.warning(
                "High token count detected before model call: ~%d tokens. "
                "Consider enabling summarization or reducing context.",
                estimated_tokens,
            )
        try:
            result = handler(request)
            self._consecutive_errors = 0
            return result
        except GraphBubbleUp:
            raise
        except Exception as exc:
            return self._handle_error(exc, lang=_detect_lang_from_messages(messages))

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelCallResult:
        messages = getattr(request, "messages", None)
        estimated_tokens = _estimate_message_tokens(messages)
        if estimated_tokens > 8000:
            logger.warning(
                "High token count detected before model call: ~%d tokens. "
                "Consider enabling summarization or reducing context.",
                estimated_tokens,
            )
        try:
            result = await handler(request)
            self._consecutive_errors = 0
            return result
        except GraphBubbleUp:
            raise
        except Exception as exc:
            return self._handle_error(exc, lang=_detect_lang_from_messages(messages))
