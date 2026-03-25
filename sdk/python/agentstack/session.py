"""
AgentStack Session

Represents a single agent execution session. Tracks spans,
events, and metadata. Supports context manager usage for
automatic lifecycle management.
"""

import time
import uuid
import logging
from typing import Any, Dict, List, Optional

from agentstack.span import Span
from agentstack.sampling import SamplingConfig

logger = logging.getLogger("agentstack.session")


class Session:
    """
    An AgentStack tracing session.

    Groups related spans (LLM calls, tool invocations, etc.) into a single
    logical unit of work. Sends start/end lifecycle events to the API server.

    Usage as context manager:
        with Session(client=client, agent_name="my-agent") as session:
            with session.span("llm-call", span_type="llm_call") as span:
                span.set_input({"prompt": "Hello"})
                span.set_output("Hi there!")
                span.set_tokens(10, 5)

    Manual usage:
        session = Session(client=client, agent_name="my-agent")
        session.start()
        # ... create spans ...
        session.end()
    """

    def __init__(
        self,
        client: Any,
        agent_name: str = "default",
        metadata: Optional[Dict[str, Any]] = None,
        tags: Optional[Dict[str, str]] = None,
        user_id: Optional[str] = None,
        sampling_config: Optional[SamplingConfig] = None,
    ):
        """
        Args:
            client: The AgentStackClient instance for API communication.
            agent_name: Name of the agent running this session.
            metadata: Optional metadata dict attached to the session.
            tags: Optional tags dict for filtering/grouping sessions.
            user_id: Optional end-user identifier.
            sampling_config: Optional SamplingConfig. When rate < 1.0,
                events are buffered in memory and a keep/drop decision
                is made at session.end().
        """
        self.id: str = str(uuid.uuid4())
        self._client = client
        self.agent_name: str = agent_name
        self.metadata: Dict[str, Any] = metadata or {}
        self.tags: Dict[str, str] = tags or {}
        self.user_id: Optional[str] = user_id

        self.status: str = "pending"  # pending, running, completed, failed
        self.start_time: Optional[float] = None
        self.end_time: Optional[float] = None
        self.duration_ms: Optional[float] = None

        self._spans: List[Span] = []
        self._events: List[Dict[str, Any]] = []
        self._span_stack: List[Span] = []  # for nested span tracking

        self.total_tokens: int = 0
        self.total_cost_cents: int = 0
        self.error: Optional[str] = None

        # Sampling support: buffer events when rate < 1.0
        self._sampling_config: Optional[SamplingConfig] = sampling_config
        self._event_buffer: Optional[List[Dict[str, Any]]] = (
            [] if sampling_config and sampling_config.rate < 1.0 else None
        )
        self._buffer_cap: int = 1000

    def _send_or_buffer(self, event: Dict[str, Any]) -> None:
        """Send an event directly or buffer it when sampling is active."""
        if self._event_buffer is not None:
            if len(self._event_buffer) >= self._buffer_cap:
                # Drop oldest events to stay within cap
                dropped = self._event_buffer.pop(0)
                logger.warning(
                    "Session '%s' event buffer full (%d), dropping oldest event: %s",
                    self.id, self._buffer_cap, dropped.get("type", "unknown"),
                )
            self._event_buffer.append(event)
        else:
            self._client.send_event(event)

    def start(self) -> "Session":
        """Start the session and send a session_start event."""
        self.start_time = time.time()
        self.status = "running"

        self._send_or_buffer({
            "type": "session_start",
            "session_id": self.id,
            "agent_name": self.agent_name,
            "metadata": self.metadata,
            "tags": self.tags,
            "user_id": self.user_id,
            "timestamp": self.start_time,
        })

        logger.debug("Session '%s' started [%s]", self.agent_name, self.id)
        return self

    def end(self, error: Optional[str] = None) -> "Session":
        """
        End the session and send a session_end event.

        When sampling is active (rate < 1.0), makes a keep/drop decision:
        - Keep: flushes all buffered events plus the session_end event.
        - Drop: sends only a lightweight session_counter event for
          accurate aggregate metrics.

        Args:
            error: Optional error message if the session failed.
        """
        self.end_time = time.time()
        if self.start_time:
            self.duration_ms = (self.end_time - self.start_time) * 1000

        if error:
            self.error = error
            self.status = "failed"
        elif self.status == "running":
            self.status = "completed"

        # Aggregate token/cost totals from spans
        self.total_tokens = sum(
            s.input_tokens + s.output_tokens for s in self._spans
        )
        self.total_cost_cents = sum(s.cost_cents for s in self._spans)

        if self._sampling_config and self._event_buffer is not None:
            # Sampling path: decide whether to send full data or just a counter
            if self._sampling_config.should_send_full(
                self.status, self.duration_ms or 0, self.total_cost_cents
            ):
                # Flush all buffered events
                for event in self._event_buffer:
                    self._client.send_event(event)
                # Send normal session_end event
                self._client.send_event({
                    "type": "session_end",
                    "session_id": self.id,
                    "agent_name": self.agent_name,
                    "status": self.status,
                    "error": self.error,
                    "duration_ms": self.duration_ms,
                    "total_tokens": self.total_tokens,
                    "total_cost_cents": self.total_cost_cents,
                    "span_count": len(self._spans),
                    "timestamp": self.end_time,
                })
            else:
                # Send lightweight counter event only
                self._client.send_event({
                    "type": "session_counter",
                    "session_id": self.id,
                    "agent_name": self.agent_name,
                    "status": self.status,
                    "total_tokens": self.total_tokens,
                    "total_cost_cents": self.total_cost_cents,
                    "duration_ms": int(self.duration_ms or 0),
                    "span_count": len(self._spans),
                    "timestamp": self.end_time,
                })
            # Clear the buffer
            self._event_buffer = None
        else:
            # Normal path — send session_end directly
            self._client.send_event({
                "type": "session_end",
                "session_id": self.id,
                "agent_name": self.agent_name,
                "status": self.status,
                "error": self.error,
                "duration_ms": self.duration_ms,
                "total_tokens": self.total_tokens,
                "total_cost_cents": self.total_cost_cents,
                "span_count": len(self._spans),
                "timestamp": self.end_time,
            })

        # Flush to ensure all events are sent
        self._client.flush()

        logger.debug(
            "Session '%s' ended [%s] — %s (%.1fms, %d spans)",
            self.agent_name, self.id, self.status,
            self.duration_ms or 0, len(self._spans),
        )
        return self

    def span(
        self,
        name: str,
        span_type: str = "custom",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Span:
        """
        Create a new span within this session.

        Can be used as a context manager:
            with session.span("my-step", span_type="llm_call") as span:
                ...

        Args:
            name: Human-readable span name.
            span_type: One of: llm_call, tool_call, retrieval, chain, agent, custom.
            metadata: Optional metadata dict.

        Returns:
            A new Span instance.
        """
        # Determine parent span (for nested span support)
        parent_span_id = self._span_stack[-1].id if self._span_stack else None

        new_span = Span(
            session=self,
            name=name,
            span_type=span_type,
            parent_span_id=parent_span_id,
            metadata=metadata,
        )
        self._spans.append(new_span)
        return new_span

    def push_span(self, span: Span) -> None:
        """Push a span onto the nesting stack (used internally by context managers)."""
        self._span_stack.append(span)

    def pop_span(self) -> Optional[Span]:
        """Pop the most recent span from the nesting stack."""
        return self._span_stack.pop() if self._span_stack else None

    @property
    def current_span(self) -> Optional[Span]:
        """Get the current active span, if any."""
        return self._span_stack[-1] if self._span_stack else None

    def add_event(self, category: str, event_type: str, data: Dict[str, Any]) -> None:
        """
        Add a custom event to this session.

        Args:
            category: Event category (e.g., "span", "healing", "guard").
            event_type: Specific event type (e.g., "llm_call", "loop_break").
            data: Event data dict.
        """
        event = {
            "type": f"{category}.{event_type}",
            "session_id": self.id,
            "data": data,
            "timestamp": time.time(),
        }
        self._events.append(event)
        self._send_or_buffer(event)

    def set_metadata(self, key: str, value: Any) -> "Session":
        """
        Set a metadata key-value pair on this session.

        Args:
            key: Metadata key.
            value: Metadata value.
        """
        self.metadata[key] = value
        return self

    @property
    def spans(self) -> List[Span]:
        """Return all spans created in this session."""
        return list(self._spans)

    @property
    def events(self) -> List[Dict[str, Any]]:
        """Return all events recorded in this session."""
        return list(self._events)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize the session to a dict."""
        return {
            "session_id": self.id,
            "agent_name": self.agent_name,
            "status": self.status,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "duration_ms": self.duration_ms,
            "total_tokens": self.total_tokens,
            "total_cost_cents": self.total_cost_cents,
            "span_count": len(self._spans),
            "metadata": self.metadata,
            "tags": self.tags,
            "user_id": self.user_id,
            "error": self.error,
        }

    def __enter__(self) -> "Session":
        """Enter the session context — starts the session."""
        self.start()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> bool:
        """Exit the session context — records error if any, then ends the session."""
        error_msg = str(exc_val) if exc_val is not None else None
        self.end(error=error_msg)
        # Do not suppress exceptions
        return False

    def __repr__(self) -> str:
        return (
            f"<Session agent={self.agent_name!r} status={self.status!r} "
            f"spans={len(self._spans)} id={self.id[:8]}...>"
        )
