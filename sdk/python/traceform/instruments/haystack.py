"""
Traceform Auto-Instrumentation for Haystack

Monkey-patches Haystack's Pipeline.run() to automatically create spans
for each pipeline execution, capturing component names, inputs, and outputs.

Safe to import even if haystack is not installed.
"""

import functools
import logging
import time
from typing import Any, Dict, Optional

logger = logging.getLogger("traceform.instruments.haystack")

_original_run: Optional[Any] = None
_instrumented = False


def _run_wrapper(original_fn: Any) -> Any:
    """Wrap Pipeline.run() to create a span for each pipeline execution."""

    @functools.wraps(original_fn)
    def wrapper(self: Any, data: Any, **kwargs: Any) -> Any:
        from traceform.trace import get_current_session

        session = get_current_session()
        if session is None:
            return original_fn(self, data, **kwargs)

        # Extract pipeline metadata
        pipeline_name = "pipeline"
        try:
            metadata = getattr(self, "metadata", {})
            if isinstance(metadata, dict):
                pipeline_name = metadata.get("name", "pipeline")
        except Exception:
            pass

        input_summary: Dict[str, Any] = {"pipeline_name": pipeline_name}
        try:
            # Capture component names in the pipeline graph
            if hasattr(self, "graph") and hasattr(self.graph, "nodes"):
                node_names = list(self.graph.nodes)
                input_summary["components"] = node_names[:20]
                input_summary["component_count"] = len(node_names)

            # Capture input data summary
            if isinstance(data, dict):
                input_summary["input_keys"] = list(data.keys())[:10]
                for k, v in list(data.items())[:3]:
                    val_str = str(v)
                    if len(val_str) > 200:
                        val_str = val_str[:200] + "...(truncated)"
                    input_summary[f"input.{k}"] = val_str
            else:
                data_str = str(data)
                if len(data_str) > 500:
                    data_str = data_str[:500] + "...(truncated)"
                input_summary["input"] = data_str
        except Exception:
            logger.debug("Failed to extract Haystack pipeline info", exc_info=True)

        span = session.span(
            name=f"haystack.{pipeline_name}",
            span_type="chain",
        )

        with span:
            span.set_input(input_summary)

            start = time.time()
            result = original_fn(self, data, **kwargs)
            latency_ms = (time.time() - start) * 1000

            span.set_metadata("latency_ms", round(latency_ms, 1))

            # Capture output
            try:
                if result is not None:
                    if isinstance(result, dict):
                        output_summary: Dict[str, Any] = {
                            "output_keys": list(result.keys())[:10],
                        }
                        for k, v in list(result.items())[:3]:
                            val_str = str(v)
                            if len(val_str) > 500:
                                val_str = val_str[:500] + "...(truncated)"
                            output_summary[k] = val_str
                        span.set_output(output_summary)
                    else:
                        output_str = str(result)
                        if len(output_str) > 2000:
                            output_str = output_str[:2000] + "...(truncated)"
                        span.set_output(output_str)
            except Exception:
                logger.debug("Failed to extract Haystack output data", exc_info=True)

            return result

    return wrapper


def instrument() -> None:
    """
    Instrument the Haystack library for automatic tracing.

    Monkey-patches haystack.Pipeline.run to automatically create spans.

    Raises:
        ImportError: If the haystack-ai library is not installed.
    """
    global _original_run, _instrumented

    if _instrumented:
        logger.debug("Haystack already instrumented, skipping.")
        return

    try:
        from haystack import Pipeline
    except ImportError:
        raise ImportError(
            "The 'haystack-ai' package is required for Haystack instrumentation. "
            "Install it with: pip install haystack-ai"
        )

    # Patch Pipeline.run
    _original_run = Pipeline.run
    Pipeline.run = _run_wrapper(_original_run)  # type: ignore

    _instrumented = True
    logger.info("Haystack auto-instrumentation enabled.")


def uninstrument() -> None:
    """Remove Haystack instrumentation, restoring original methods."""
    global _original_run, _instrumented

    if not _instrumented:
        return

    try:
        from haystack import Pipeline

        if _original_run is not None:
            Pipeline.run = _original_run  # type: ignore
    except ImportError:
        pass

    _original_run = None
    _instrumented = False
    logger.info("Haystack auto-instrumentation removed.")
