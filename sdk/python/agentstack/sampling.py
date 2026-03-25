"""Sampling configuration and decision logic for AgentStack SDK."""

import random
from dataclasses import dataclass


@dataclass
class SamplingConfig:
    """Configuration for session sampling.

    When rate < 1.0, the SDK buffers all events for a session in memory
    and makes a keep/drop decision at session.end(). Dropped sessions
    still emit a lightweight counter event for accurate aggregate metrics.
    """
    rate: float = 1.0
    always_keep_errors: bool = True
    always_keep_slow_ms: int = 5000
    always_keep_costly: int = 500  # cents

    def should_send_full(self, status: str, duration_ms: float, total_cost_cents: int) -> bool:
        """Decide whether to send full session data or just a counter."""
        if self.rate >= 1.0:
            return True
        if self.always_keep_errors and status in ('failed', 'healed', 'timeout'):
            return True
        if duration_ms and duration_ms > self.always_keep_slow_ms:
            return True
        if total_cost_cents > self.always_keep_costly:
            return True
        return random.random() < self.rate
