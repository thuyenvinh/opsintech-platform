"""Middleware for intercepting clarification requests and presenting them to the user."""

import json
import re
from collections.abc import Callable
from typing import override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import ToolMessage
from langgraph.graph import END
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.types import Command


class ClarificationMiddlewareState(AgentState):
    """Compatible with the `ThreadState` schema."""

    pass


class ClarificationMiddleware(AgentMiddleware[ClarificationMiddlewareState]):
    """Intercepts clarification tool calls and interrupts execution to present questions to the user.

    When the model calls the `ask_clarification` tool, this middleware:
    1. Intercepts the tool call before execution
    2. Extracts the clarification question and metadata
    3. Formats a user-friendly message
    4. Returns a Command that interrupts execution and presents the question
    5. Waits for user response before continuing

    This replaces the tool-based approach where clarification continued the conversation flow.
    """

    state_schema = ClarificationMiddlewareState

    def _is_chinese(self, text: str) -> bool:
        """Check if text contains Chinese characters."""
        return any("\u4e00" <= char <= "\u9fff" for char in text)

    def _is_vietnamese(self, text: str) -> bool:
        """Check if text contains Vietnamese diacritic characters."""
        return bool(re.search(r"[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđĐ]", text))

    def _detect_lang(self, args: dict, user_text: str = "") -> str:
        """Detect conversation language ('vi', 'zh', or 'en') from question and user text."""
        question = self._normalize_text(args.get("question"))
        sample = f"{question}\n{user_text}".strip()
        if self._is_vietnamese(sample):
            return "vi"
        if self._is_chinese(sample):
            return "zh"
        return "en"

    def _normalize_text(self, value: object) -> str:
        """Normalize user-facing text and recover from per-character line breaks."""
        if not isinstance(value, str):
            return ""

        text = value.replace("\r\n", "\n").replace("\r", "\n")
        text = re.sub(r"[\u200b\u200c\u200d\ufeff]", "", text)
        text = text.strip()

        # Some model outputs arrive as one character per line/token;
        # if most whitespace-separated tokens are single-char, join them.
        tokens = [token for token in re.split(r"\s+", text) if token]
        if "\n" in text and len(tokens) >= 4:
            single_char_ratio = sum(1 for token in tokens if len(token) == 1) / len(tokens)
            if single_char_ratio >= 0.8:
                text = "".join(tokens)

        # Also collapse accidental spaces/newlines between adjacent CJK chars.
        text = re.sub(r"(?<=[\u4e00-\u9fff])[\s\u00a0]+(?=[\u4e00-\u9fff])", "", text)
        return text.strip().strip('"')

    def _normalize_options(self, value: object) -> list[str]:
        """Normalize options that may come as list or a JSON array string."""
        raw_options: list[object]
        if isinstance(value, str):
            normalized = self._normalize_text(value)
            if normalized.startswith("[") and normalized.endswith("]"):
                try:
                    parsed = json.loads(normalized)
                except json.JSONDecodeError:
                    raw_options = [normalized]
                else:
                    raw_options = parsed if isinstance(parsed, list) else [normalized]
            else:
                raw_options = [normalized]
        elif isinstance(value, list):
            raw_options = value
        else:
            raw_options = []

        options: list[str] = []
        for option in raw_options:
            normalized_option = self._normalize_text(option)
            if normalized_option:
                options.append(normalized_option)
        return options

    def _build_fallback_reasoning(self, args: dict, user_text: str = "") -> str:
        """Generate a contextual hint when the model didn't provide reasoning text.

        Args:
            args: The tool call arguments containing clarification_type and context
            user_text: Optional latest human message text for language detection

        Returns:
            A human-readable fallback explanation string
        """
        clarification_type = args.get("clarification_type", "missing_info")
        lang = self._detect_lang(args, user_text)

        fallbacks_by_lang = {
            "vi": {
                "missing_info": "Tôi cần thêm thông tin để tiếp tục.",
                "ambiguous_requirement": "Yêu cầu của bạn có thể hiểu theo nhiều cách, tôi cần xác nhận lại.",
                "approach_choice": "Có một số hướng thực hiện, vui lòng chọn phương án phù hợp nhất.",
                "risk_confirmation": "Thao tác này có rủi ro nhất định, sau khi bạn xác nhận tôi sẽ tiếp tục.",
                "suggestion": "Tôi có một đề xuất, muốn nghe ý kiến của bạn trước.",
                "_default": "Trước khi tiếp tục, tôi cần xác nhận thêm một số thông tin.",
            },
            "zh": {
                "missing_info": "我需要更多信息才能继续。",
                "ambiguous_requirement": "你的需求有几种可能的理解方式，我需要确认一下。",
                "approach_choice": "有几种方式可以实现，我需要你帮我选择最合适的。",
                "risk_confirmation": "这个操作有一定风险，确认后我将继续。",
                "suggestion": "我有一个建议，想先听听你的意见。",
                "_default": "在继续之前，我需要确认一些信息。",
            },
            "en": {
                "missing_info": "I need more information before continuing.",
                "ambiguous_requirement": "Your request could be interpreted in a few ways; please clarify.",
                "approach_choice": "There are multiple approaches; please choose the most suitable one.",
                "risk_confirmation": "This operation carries some risk; I will proceed once you confirm.",
                "suggestion": "I have a suggestion and would like your feedback first.",
                "_default": "Before continuing, I need to confirm a few details.",
            },
        }

        lang_map = fallbacks_by_lang.get(lang, fallbacks_by_lang["en"])
        return lang_map.get(clarification_type, lang_map["_default"])

    def _format_clarification_message(self, args: dict, model_reasoning: str = "") -> str:
        """Format the clarification arguments into a user-friendly message.

        Args:
            args: The tool call arguments containing clarification details
            model_reasoning: Optional reasoning text from the preceding AI message

        Returns:
            Formatted message string
        """
        question = self._normalize_text(args.get("question", ""))
        clarification_type = args.get("clarification_type", "missing_info")
        context = self._normalize_text(args.get("context"))
        options = self._normalize_options(args.get("options", []))

        # Type-specific icons
        type_icons = {
            "missing_info": "❓",
            "ambiguous_requirement": "🤔",
            "approach_choice": "🔀",
            "risk_confirmation": "⚠️",
            "suggestion": "💡",
        }

        icon = type_icons.get(clarification_type, "❓")

        # Build the message naturally
        message_parts = []

        # Include model's reasoning text first if available (rendered as markdown in frontend)
        if model_reasoning:
            message_parts.append(model_reasoning)
            message_parts.append("")  # blank line separator

        # Add icon and question together for a more natural flow
        if context:
            # If there's context, present it first as background
            message_parts.append(f"{icon} {context}")
            message_parts.append(f"\n{question}")
        else:
            # Just the question with icon
            message_parts.append(f"{icon} {question}")

        # Add options in a cleaner format
        if options and len(options) > 0:
            message_parts.append("")  # blank line for spacing
            for i, option in enumerate(options, 1):
                message_parts.append(f"  {i}. {option}")

        return "\n".join(message_parts)

    def _handle_clarification(self, request: ToolCallRequest) -> Command:
        """Handle clarification request and return command to interrupt execution.

        Args:
            request: Tool call request

        Returns:
            Command that interrupts execution with the formatted clarification message
        """
        # Extract clarification arguments
        args = request.tool_call.get("args", {})
        question = args.get("question", "")

        print("[ClarificationMiddleware] Intercepted clarification request")
        print(f"[ClarificationMiddleware] Question: {question}")

        # Extract preceding AI message content (model's reasoning before the tool call)
        model_reasoning = ""
        latest_human_text = ""
        if request.state:
            messages = request.state.get("messages", [])
            for msg in reversed(messages):
                msg_type = getattr(msg, "type", None)
                if not model_reasoning and msg_type == "ai":
                    content = getattr(msg, "content", "") or ""
                    if isinstance(content, str) and content.strip():
                        model_reasoning = content.strip()
                elif not latest_human_text and msg_type == "human":
                    content = getattr(msg, "content", "") or ""
                    if isinstance(content, str) and content.strip():
                        latest_human_text = content.strip()
                if model_reasoning and latest_human_text:
                    break

        # Fallback: if model didn't provide reasoning, generate a contextual hint
        if not model_reasoning:
            model_reasoning = self._build_fallback_reasoning(args, user_text=latest_human_text)

        # Format the clarification message, including model reasoning if available
        formatted_message = self._format_clarification_message(args, model_reasoning=model_reasoning)

        # Get the tool call ID
        tool_call_id = request.tool_call.get("id", "")

        # Create a ToolMessage with the formatted question
        # This will be added to the message history
        tool_message = ToolMessage(
            content=formatted_message,
            tool_call_id=tool_call_id,
            name="ask_clarification",
        )

        # Return a Command that:
        # 1. Adds the formatted tool message
        # 2. Interrupts execution by going to __end__
        # Note: We don't add an extra AIMessage here - the frontend will detect
        # and display ask_clarification tool messages directly
        return Command(
            update={"messages": [tool_message]},
            goto=END,
        )

    @override
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        """Intercept ask_clarification tool calls and interrupt execution (sync version).

        Args:
            request: Tool call request
            handler: Original tool execution handler

        Returns:
            Command that interrupts execution with the formatted clarification message
        """
        # Check if this is an ask_clarification tool call
        if request.tool_call.get("name") != "ask_clarification":
            # Not a clarification call, execute normally
            return handler(request)

        return self._handle_clarification(request)

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        """Intercept ask_clarification tool calls and interrupt execution (async version).

        Args:
            request: Tool call request
            handler: Original tool execution handler (async)

        Returns:
            Command that interrupts execution with the formatted clarification message
        """
        # Check if this is an ask_clarification tool call
        if request.tool_call.get("name") != "ask_clarification":
            # Not a clarification call, execute normally
            return await handler(request)

        return self._handle_clarification(request)
