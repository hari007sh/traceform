"""
Traceform Auto-Instrumentation for AutoGen/AG2

Monkey-patches AutoGen's ConversableAgent.generate_reply() to automatically
create spans for each agent conversation turn, capturing agent names,
messages, and outputs.

Supports both the `autogen` and `ag2` package namespaces.

Safe to import even if autogen/ag2 is not installed.
"""

import functools
import logging
import time
from typing import Any, Dict, Optional

logger = logging.getLogger("traceform.instruments.autogen")

_original_generate_reply: Optional[Any] = None
_instrumented = False
_agent_module: Optional[str] = None  # Track which module we patched


def _generate_reply_wrapper(original_fn: Any) -> Any:
    """Wrap ConversableAgent.generate_reply() to create a span per agent turn."""

    @functools.wraps(original_fn)
    def wrapper(self: Any, messages: Any = None, sender: Any = None, **kwargs: Any) -> Any:
        from traceform.trace import get_current_session

        session = get_current_session()
        if session is None:
            return original_fn(self, messages, sender, **kwargs)

        agent_name = getattr(self, "name", "agent")

        input_summary: Dict[str, Any] = {"agent_name": agent_name}
        try:
            if sender is not None:
                sender_name = getattr(sender, "name", str(sender))
                input_summary["sender"] = sender_name

            if messages:
                input_summary["message_count"] = len(messages)
                last_msg = messages[-1] if messages else {}
                if isinstance(last_msg, dict):
                    content = last_msg.get("content", "")
                    if isinstance(content, str) and len(content) > 500:
                        content = content[:500] + "...(truncated)"
                    input_summary["last_message"] = content
                    input_summary["last_role"] = last_msg.get("role", "unknown")
                else:
                    msg_str = str(last_msg)
                    if len(msg_str) > 500:
                        msg_str = msg_str[:500] + "...(truncated)"
                    input_summary["last_message"] = msg_str
        except Exception:
            logger.debug("Failed to extract AutoGen input info", exc_info=True)

        span = session.span(
            name=f"autogen.{agent_name}",
            span_type="agent",
        )

        with span:
            span.set_input(input_summary)

            start = time.time()
            result = original_fn(self, messages, sender, **kwargs)
            latency_ms = (time.time() - start) * 1000

            span.set_metadata("latency_ms", round(latency_ms, 1))

            # Capture output
            try:
                if result is not None:
                    output_str = str(result)
                    if len(output_str) > 2000:
                        output_str = output_str[:2000] + "...(truncated)"
                    span.set_output(output_str)
            except Exception:
                pass

            return result

    return wrapper


def instrument() -> None:
    """
    Instrument the AutoGen/AG2 library for automatic tracing.

    Monkey-patches ConversableAgent.generate_reply to automatically
    create spans. Tries importing from `autogen` first, then `ag2`.

    Raises:
        ImportError: If neither autogen nor ag2 is installed.
    """
    global _original_generate_reply, _instrumented, _agent_module

    if _instrumented:
        logger.debug("AutoGen already instrumented, skipping.")
        return

    ConversableAgent = None

    # Try autogen first, then ag2
    try:
        from autogen import ConversableAgent as _CA
        ConversableAgent = _CA
        _agent_module = "autogen"
    except ImportError:
        try:
            from ag2 import ConversableAgent as _CA
            ConversableAgent = _CA
            _agent_module = "ag2"
        except ImportError:
            raise ImportError(
                "Either 'pyautogen' or 'ag2' package is required for AutoGen instrumentation. "
                "Install with: pip install pyautogen  OR  pip install ag2"
            )

    # Patch generate_reply
    _original_generate_reply = ConversableAgent.generate_reply
    ConversableAgent.generate_reply = _generate_reply_wrapper(_original_generate_reply)  # type: ignore

    _instrumented = True
    logger.info("AutoGen (%s) auto-instrumentation enabled.", _agent_module)


def uninstrument() -> None:
    """Remove AutoGen instrumentation, restoring original methods."""
    global _original_generate_reply, _instrumented, _agent_module

    if not _instrumented:
        return

    try:
        if _agent_module == "autogen":
            from autogen import ConversableAgent
        elif _agent_module == "ag2":
            from ag2 import ConversableAgent  # type: ignore
        else:
            return

        if _original_generate_reply is not None:
            ConversableAgent.generate_reply = _original_generate_reply  # type: ignore
    except ImportError:
        pass

    _original_generate_reply = None
    _instrumented = False
    _agent_module = None
    logger.info("AutoGen auto-instrumentation removed.")
