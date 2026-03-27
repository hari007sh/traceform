import { Event, HealingEvent } from './types';

// ─── Counter Payload ──────────────────────────────────────────────────────
// Lightweight summary sent when a session is sampled-out (dropped).

export interface CounterPayload {
  sessionId: string;
  status: string;
  spanCount: number;
  totalTokens: number;
  totalCostCents: number;
  durationMs: number;
  droppedEventCount: number;
  timestamp: string;
}

// ─── Backend Payload Types ─────────────────────────────────────────────────
// These match the Go backend's service.BatchIngestRequest exactly.

interface SessionPayload {
  id: string;
  agent_name: string;
  agent_id?: string;
  status: string;
  input?: string;
  output?: string;
  error?: string;
  metadata?: string;
  total_tokens?: number;
  total_cost_cents?: number;
  total_spans?: number;
  duration_ms?: number;
  has_healing?: number;
  tags?: string[];
  started_at: string;
  ended_at?: string;
}

interface SpanPayload {
  id: string;
  session_id: string;
  parent_id?: string;
  name: string;
  span_type: string;
  status: string;
  input?: string;
  output?: string;
  error?: string;
  model?: string;
  provider?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cost_cents?: number;
  duration_ms?: number;
  metadata?: string;
  started_at: string;
  ended_at?: string;
}

interface EventPayload {
  id: string;
  session_id: string;
  span_id?: string;
  type: string;
  name?: string;
  data?: string;
  created_at: string;
}

interface BatchPayload {
  sessions: SessionPayload[];
  spans: SpanPayload[];
  events: EventPayload[];
}

interface HealingPayload {
  id: string;
  session_id: string;
  span_id?: string;
  type: string;
  trigger: string;
  action: string;
  description: string;
  resolved: boolean;
  timestamp: string;
}

interface ClientConfig {
  apiKey: string;
  projectId: string;
  endpoint: string;
  batchSize: number;
  flushIntervalMs: number;
  maxRetries: number;
  debug: boolean;
}

// ─── TraceformClient ───────────────────────────────────────────────────────

export class TraceformClient {
  private static readonly MAX_BUFFER_SIZE = 10_000;

  private config: ClientConfig;
  private sessionBuffer: SessionPayload[] = [];
  private spanBuffer: SpanPayload[] = [];
  private eventBuffer: EventPayload[] = [];
  private healingBuffer: HealingPayload[] = [];
  private counterBuffer: CounterPayload[] = [];
  // Legacy event buffer for backward compatibility with internal SDK events
  private legacyEventBuffer: Event[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;

  /** Server-suggested sample rate parsed from the X-Traceform-Sample-Rate header. */
  private _serverSampleRate: number | null = null;

  constructor(config: Partial<ClientConfig> & { apiKey: string; projectId: string }) {
    this.config = {
      endpoint: 'https://api.traceform.dev',
      batchSize: 50,
      flushIntervalMs: 5000,
      maxRetries: 3,
      debug: false,
      ...config,
    };

    this.startFlushInterval();

    // Flush remaining events when the process exits (Node.js only).
    if (typeof process !== 'undefined' && typeof process.on === 'function') {
      process.on('beforeExit', () => {
        void this.flush();
      });
    }
  }

  // ── Buffer helpers ──────────────────────────────────────────────────────

  /**
   * Push an item to a buffer, dropping the oldest entry when the buffer
   * exceeds MAX_BUFFER_SIZE.
   */
  private boundedPush<T>(buffer: T[], item: T): void {
    if (buffer.length >= TraceformClient.MAX_BUFFER_SIZE) {
      buffer.shift();
      this.log(`Buffer at capacity (${TraceformClient.MAX_BUFFER_SIZE}), oldest entry dropped`);
    }
    buffer.push(item);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Add a session payload for ingestion.
   */
  addSession(session: SessionPayload): void {
    this.boundedPush(this.sessionBuffer, session);
    this.maybeFlush();
  }

  /**
   * Add a span payload for ingestion.
   */
  addSpan(span: SpanPayload): void {
    this.boundedPush(this.spanBuffer, span);
    this.maybeFlush();
  }

  /**
   * Add an event payload for ingestion.
   */
  addEventPayload(event: EventPayload): void {
    this.boundedPush(this.eventBuffer, event);
    this.maybeFlush();
  }

  /**
   * Add an internal Event (legacy format used by session/span lifecycle).
   * These are translated to EventPayload and buffered for batch ingestion.
   */
  addEvent(event: Event): void {
    this.boundedPush(this.legacyEventBuffer, event);

    // Also buffer as a proper EventPayload for the backend
    const payload: EventPayload = {
      id: event.id,
      session_id: event.sessionId,
      span_id: event.spanId,
      type: event.type,
      name: event.type,
      data: typeof event.data === 'string' ? event.data : JSON.stringify(event.data),
      created_at: event.timestamp,
    };
    this.boundedPush(this.eventBuffer, payload);
    this.maybeFlush();
  }

  /**
   * Add a healing event for ingestion.
   */
  addHealingEvent(event: HealingEvent): void {
    const payload: HealingPayload = {
      id: event.id,
      session_id: event.sessionId,
      span_id: event.spanId,
      type: event.type,
      trigger: event.trigger,
      action: event.intervention.action,
      description: event.intervention.description,
      resolved: event.resolved,
      timestamp: event.timestamp,
    };
    this.boundedPush(this.healingBuffer, payload);
    this.maybeFlush();
  }

  /**
   * Send a lightweight counter for a sampled-out (dropped) session.
   * Counters are batched and flushed together with the normal payload.
   */
  sendCounter(counter: CounterPayload): void {
    this.boundedPush(this.counterBuffer, counter);
    this.maybeFlush();
  }

  /**
   * Returns the server-suggested sample rate if one has been received,
   * or null if the server has not yet provided a rate.
   */
  get serverSampleRate(): number | null {
    return this._serverSampleRate;
  }

  async flush(): Promise<void> {
    if (this.isFlushing) return;

    const hasBatchData = this.sessionBuffer.length > 0 || this.spanBuffer.length > 0 || this.eventBuffer.length > 0;
    const hasHealingData = this.healingBuffer.length > 0;
    const hasCounterData = this.counterBuffer.length > 0;

    if (!hasBatchData && !hasHealingData && !hasCounterData) return;

    this.isFlushing = true;

    // Drain buffers
    const sessions = this.sessionBuffer.splice(0);
    const spans = this.spanBuffer.splice(0);
    const events = this.eventBuffer.splice(0);
    const healingEvents = this.healingBuffer.splice(0);
    const counters = this.counterBuffer.splice(0);
    this.legacyEventBuffer.splice(0);

    try {
      // Send batch of sessions/spans/events (+ counters when present)
      if (sessions.length > 0 || spans.length > 0 || events.length > 0 || counters.length > 0) {
        const batchPayload: BatchPayload & { counters?: CounterPayload[] } = { sessions, spans, events };
        if (counters.length > 0) {
          batchPayload.counters = counters;
        }
        await this.sendBatchWithRetry(batchPayload);
        this.log(
          `Flushed batch: ${sessions.length} sessions, ${spans.length} spans, ${events.length} events, ${counters.length} counters`,
        );
      }

      // Send healing events
      if (healingEvents.length > 0) {
        for (const he of healingEvents) {
          await this.sendHealingWithRetry(he);
        }
        this.log(`Flushed ${healingEvents.length} healing events`);
      }
    } catch (err) {
      // Put data back in the buffers on failure.
      // Avoid .unshift(...arr) with spread — large arrays blow the call stack.
      // Concat and slice to respect MAX_BUFFER_SIZE.
      const max = TraceformClient.MAX_BUFFER_SIZE;
      this.sessionBuffer = sessions.concat(this.sessionBuffer).slice(0, max);
      this.spanBuffer = spans.concat(this.spanBuffer).slice(0, max);
      this.eventBuffer = events.concat(this.eventBuffer).slice(0, max);
      this.healingBuffer = healingEvents.concat(this.healingBuffer).slice(0, max);
      this.counterBuffer = counters.concat(this.counterBuffer).slice(0, max);
      this.log(`Failed to flush: ${err}`);
    } finally {
      this.isFlushing = false;
    }
  }

  async shutdown(): Promise<void> {
    this.stopFlushInterval();
    await this.flush();
  }

  // ── Internal: Batch ────────────────────────────────────────────────────

  private async sendBatchWithRetry(payload: BatchPayload): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        await this.sendJSON(`${this.config.endpoint}/v1/ingest/batch`, payload);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.config.maxRetries - 1) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
          this.log(`Retry batch ${attempt + 1}/${this.config.maxRetries} in ${backoffMs}ms`);
          await this.sleep(backoffMs);
        }
      }
    }

    throw lastError ?? new Error('Batch send failed after retries');
  }

  private async sendHealingWithRetry(payload: HealingPayload): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        await this.sendJSON(`${this.config.endpoint}/v1/ingest/healing`, payload);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.config.maxRetries - 1) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
          this.log(`Retry healing ${attempt + 1}/${this.config.maxRetries} in ${backoffMs}ms`);
          await this.sleep(backoffMs);
        }
      }
    }

    throw lastError ?? new Error('Healing send failed after retries');
  }

  private async sendJSON(url: string, payload: unknown): Promise<void> {
    const fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch : undefined;

    if (!fetchFn) {
      this.log('No fetch implementation available — data buffered locally');
      return;
    }

    // Build fetch options with a 10-second timeout when the runtime supports
    // AbortSignal.timeout (Node 18.x+, modern browsers).  Fall back to no
    // timeout so we don't crash in older environments.
    const fetchOptions: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
        'X-Project-Id': this.config.projectId,
      },
      body: JSON.stringify(payload),
    };

    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      fetchOptions.signal = AbortSignal.timeout(10_000);
    }

    const response = await fetchFn(url, fetchOptions);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${response.statusText} — ${body}`);
    }

    // Parse server-provided sample rate from response headers
    const sampleRateHeader = response.headers.get('X-Traceform-Sample-Rate');
    if (sampleRateHeader) {
      const parsed = parseFloat(sampleRateHeader);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
        this._serverSampleRate = parsed;
        this.log(`Server suggested sample rate: ${parsed}`);
      }
    }
  }

  // ── Internal: Timers ────────────────────────────────────────────────────

  private maybeFlush(): void {
    const totalPending =
      this.sessionBuffer.length + this.spanBuffer.length + this.eventBuffer.length +
      this.healingBuffer.length + this.counterBuffer.length;
    if (totalPending >= this.config.batchSize) {
      void this.flush();
    }
  }

  private startFlushInterval(): void {
    if (this.config.flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => {
        void this.flush();
      }, this.config.flushIntervalMs);

      // Allow the process to exit even if the timer is running
      if (this.flushTimer && typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
        this.flushTimer.unref();
      }
    }
  }

  private stopFlushInterval(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[traceform] ${message}`);
    }
  }

  // ── Accessors (for testing) ─────────────────────────────────────────────

  get pendingEventCount(): number {
    return this.eventBuffer.length;
  }

  get pendingHealingEventCount(): number {
    return this.healingBuffer.length;
  }

  get pendingSessionCount(): number {
    return this.sessionBuffer.length;
  }

  get pendingSpanCount(): number {
    return this.spanBuffer.length;
  }

  get pendingCounterCount(): number {
    return this.counterBuffer.length;
  }

  get endpoint(): string {
    return this.config.endpoint;
  }

  get projectId(): string {
    return this.config.projectId;
  }
}
