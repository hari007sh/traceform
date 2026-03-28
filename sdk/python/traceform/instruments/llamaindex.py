"""
Traceform Auto-Instrumentation for LlamaIndex

Monkey-patches LlamaIndex's LLM.complete() and LLM.acomplete() to
automatically create spans for each LLM call, capturing model, tokens,
and response data.

Safe to import even if llama_index is not installed.
"""

import functools
import logging
import time
from typing import Any, Dict, Optional

logger = logging.getLogger("traceform.instruments.llamaindex")

_original_complete: Optional[Any] = None
_original_acomplete: Optional[Any] = None
_instrumented = False


def _complete_wrapper(original_fn: Any) -> Any:
    """Wrap LLM.complete() to create a span for each completion call."""

    @functools.wraps(original_fn)
    def wrapper(self: Any, prompt: Any, **kwargs: Any) -> Any:
        from traceform.trace import get_current_session

        session = get_current_session()
        if session is None:
            return original_fn(self, prompt, **kwargs)

        model = getattr(self, "model", "unknown")

        input_summary: Dict[str, Any] = {"model": model}
        try:
            prompt_str = str(prompt)
            if len(prompt_str) > 500:
                prompt_str = prompt_str[:500] + "...(truncated)"
            input_summary["prompt"] = prompt_str
        except Exception:
            pass

        span = session.span(
            name=f"llamaindex.llm.{model}",
            span_type="llm_call",
        )

        with span:
            span.set_input(input_summary)
            span.set_model(model, provider="llamaindex")

            start = time.time()
            result = original_fn(self, prompt, **kwargs)
            latency_ms = (time.time() - start) * 1000

            span.set_metadata("latency_ms", round(latency_ms, 1))

            # Extract output and token usage
            try:
                output_str = str(result)
                if len(output_str) > 2000:
                    output_str = output_str[:2000] + "...(truncated)"
                span.set_output(output_str)

                # LlamaIndex CompletionResponse may have a .raw with usage info
                if hasattr(result, "raw"):
                    raw = result.raw
                    usage = getattr(raw, "usage", None)
                    if usage:
                        input_tokens = getattr(usage, "prompt_tokens", 0) or 0
                        output_tokens = getattr(usage, "completion_tokens", 0) or 0
                        span.set_tokens(input_tokens, output_tokens)
            except Exception:
                logger.debug("Failed to extract LlamaIndex response data", exc_info=True)

            return result

    return wrapper


def _acomplete_wrapper(original_fn: Any) -> Any:
    """Wrap LLM.acomplete() to create a span for each async completion call."""

    @functools.wraps(original_fn)
    async def wrapper(self: Any, prompt: Any, **kwargs: Any) -> Any:
        from traceform.trace import get_current_session

        session = get_current_session()
        if session is None:
            return await original_fn(self, prompt, **kwargs)

        model = getattr(self, "model", "unknown")

        input_summary: Dict[str, Any] = {"model": model}
        try:
            prompt_str = str(prompt)
            if len(prompt_str) > 500:
                prompt_str = prompt_str[:500] + "...(truncated)"
            input_summary["prompt"] = prompt_str
        except Exception:
            pass

        span = session.span(
            name=f"llamaindex.llm.{model}",
            span_type="llm_call",
        )

        with span:
            span.set_input(input_summary)
            span.set_model(model, provider="llamaindex")

            start = time.time()
            result = await original_fn(self, prompt, **kwargs)
            latency_ms = (time.time() - start) * 1000

            span.set_metadata("latency_ms", round(latency_ms, 1))

            try:
                output_str = str(result)
                if len(output_str) > 2000:
                    output_str = output_str[:2000] + "...(truncated)"
                span.set_output(output_str)

                if hasattr(result, "raw"):
                    raw = result.raw
                    usage = getattr(raw, "usage", None)
                    if usage:
                        input_tokens = getattr(usage, "prompt_tokens", 0) or 0
                        output_tokens = getattr(usage, "completion_tokens", 0) or 0
                        span.set_tokens(input_tokens, output_tokens)
            except Exception:
                logger.debug("Failed to extract LlamaIndex response data", exc_info=True)

            return result

    return wrapper


def instrument() -> None:
    """
    Instrument the LlamaIndex library for automatic tracing.

    Monkey-patches llama_index.core.llms.LLM.complete and .acomplete
    to automatically create spans.

    Raises:
        ImportError: If the llama_index library is not installed.
    """
    global _original_complete, _original_acomplete, _instrumented

    if _instrumented:
        logger.debug("LlamaIndex already instrumented, skipping.")
        return

    try:
        from llama_index.core.llms import LLM
    except ImportError:
        raise ImportError(
            "The 'llama-index-core' package is required for LlamaIndex instrumentation. "
            "Install it with: pip install llama-index-core"
        )

    # Patch synchronous complete
    _original_complete = LLM.complete
    LLM.complete = _complete_wrapper(_original_complete)  # type: ignore

    # Patch async acomplete
    _original_acomplete = LLM.acomplete
    LLM.acomplete = _acomplete_wrapper(_original_acomplete)  # type: ignore

    _instrumented = True
    logger.info("LlamaIndex auto-instrumentation enabled.")


def uninstrument() -> None:
    """Remove LlamaIndex instrumentation, restoring original methods."""
    global _original_complete, _original_acomplete, _instrumented

    if not _instrumented:
        return

    try:
        from llama_index.core.llms import LLM

        if _original_complete is not None:
            LLM.complete = _original_complete  # type: ignore
        if _original_acomplete is not None:
            LLM.acomplete = _original_acomplete  # type: ignore
    except ImportError:
        pass

    _original_complete = None
    _original_acomplete = None
    _instrumented = False
    logger.info("LlamaIndex auto-instrumentation removed.")
