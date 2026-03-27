import { randomUUID } from 'crypto';
import {
  Session as SessionData,
  SessionStatus,
  SessionConfig,
  SpanType,
  Span,
  Event,
} from './types';
import { TraceformClient } from './client';
import { SpanInstance } from './span';
import { SamplingConfig, DEFAULT_SAMPLING_CONFIG, shouldSendFull } from './sampling';

/** Maximum number of events buffered when sampling is active. */
const BUFFER_CAP = 1000;

/** A buffered item that was intercepted instead of sent immediately. */
type BufferedItem =
  | { kind: 'session'; payload: Parameters<TraceformClient['addSession']>[0] }
  | { kind: 'event'; payload: Event }
  | { kind: 'span'; payload: Parameters<TraceformClient['addSpan']>[0] };

export class SessionInstance {
  private data: SessionData;
  private client: TraceformClient;
  private activeSpans: Map<string, SpanInstance> = new Map();
  private completedSpans: Span[] = [];

  // ── Sampling state ──────────────────────────────────────────────────────
  private samplingConfig: SamplingConfig;
  private isBuffering: boolean;
  private buffer: BufferedItem[] = [];

  constructor(client: TraceformClient, projectId: string, config?: SessionConfig) {
    this.client = client;

    // Resolve sampling config — default is rate=1.0 (no buffering)
    this.samplingConfig = config?.sampling
      ? { ...DEFAULT_SAMPLING_CONFIG, ...config.sampling }
      : DEFAULT_SAMPLING_CONFIG;

    // Buffer mode is active when the sampling rate is below 1.0
    this.isBuffering = this.samplingConfig.rate < 1.0;

    this.data = {
      id: randomUUID(),
      projectId,
      status: SessionStatus.ACTIVE,
      startedAt: new Date().toISOString(),
      metadata: config?.metadata,
      spans: [],
      events: [],
    };

    const sessionPayload = {
      id: this.data.id,
      agent_name: (config?.metadata?.agentName as string) || 'sdk-session',
      status: 'running',
      input: (config?.metadata?.input as string) || '',
      metadata: config?.metadata ? JSON.stringify(config.metadata) : '{}',
      tags: (config?.metadata?.tags as string[]) || [],
      started_at: this.data.startedAt,
    };

    const startEvent: Event = {
      id: randomUUID(),
      sessionId: this.data.id,
      type: 'session.start',
      timestamp: this.data.startedAt,
      data: {
        projectId: this.data.projectId,
        metadata: this.data.metadata ?? {},
      },
    };

    if (this.isBuffering) {
      this.pushToBuffer({ kind: 'session', payload: sessionPayload });
      this.pushToBuffer({ kind: 'event', payload: startEvent });
    } else {
      // Emit session to the backend via the typed session buffer
      this.client.addSession(sessionPayload);
      // Also emit as a legacy event for internal tracking
      this.client.addEvent(startEvent);
    }
  }

  // ── Getters ─────────────────────────────────────────────────────────────

  get id(): string {
    return this.data.id;
  }

  get status(): SessionStatus {
    return this.data.status;
  }

  get projectId(): string {
    return this.data.projectId;
  }

  // ── Span Management ────────────────────────────────────────────────────

  createSpan(
    name: string,
    type: SpanType = SpanType.CUSTOM,
    parentSpanId?: string,
    metadata?: Record<string, unknown>,
  ): SpanInstance {
    const span = new SpanInstance(this.client, name, this.data.id, type, parentSpanId, metadata);
    this.activeSpans.set(span.id, span);

    const spanStartEvent: Event = {
      id: randomUUID(),
      sessionId: this.data.id,
      spanId: span.id,
      type: 'span.start',
      timestamp: new Date().toISOString(),
      data: {
        name: span.name,
        type: span.type,
        parentSpanId: span.parentSpanId,
      },
    };

    if (this.isBuffering) {
      this.pushToBuffer({ kind: 'event', payload: spanStartEvent });
    } else {
      // Emit span start event
      this.client.addEvent(spanStartEvent);
    }

    return span;
  }

  endSpan(spanId: string): Span | undefined {
    const span = this.activeSpans.get(spanId);
    if (!span) return undefined;

    const spanData = span.end();
    this.activeSpans.delete(spanId);
    this.completedSpans.push(spanData);
    return spanData;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  start(): SessionInstance {
    this.data.status = SessionStatus.ACTIVE;
    return this;
  }

  end(status: SessionStatus = SessionStatus.COMPLETED): SessionData {
    // End all remaining active spans
    for (const [id] of this.activeSpans) {
      this.endSpan(id);
    }

    this.data.status = status;
    this.data.endedAt = new Date().toISOString();
    this.data.spans = [...this.completedSpans];

    // Compute totals for the session update
    let totalTokens = 0;
    let totalCostCents = 0;
    let totalDurationMs = 0;
    for (const span of this.completedSpans) {
      totalTokens += span.tokens?.total ?? 0;
      totalDurationMs += span.durationMs ?? 0;
      // cost_cents is carried on the metadata by the cost module
      totalCostCents += ((span.metadata?.costCents as number) ?? 0);
    }

    const statusStr = status === SessionStatus.COMPLETED ? 'completed'
      : status === SessionStatus.FAILED ? 'failed'
      : status === SessionStatus.TIMEOUT ? 'timeout'
      : status;

    const sessionEndPayload = {
      id: this.data.id,
      agent_name: (this.data.metadata?.agentName as string) || 'sdk-session',
      status: statusStr,
      total_tokens: totalTokens,
      total_cost_cents: totalCostCents,
      total_spans: this.completedSpans.length,
      duration_ms: totalDurationMs,
      tags: (this.data.metadata?.tags as string[]) || [],
      started_at: this.data.startedAt,
      ended_at: this.data.endedAt,
    };

    const endEvent: Event = {
      id: randomUUID(),
      sessionId: this.data.id,
      type: 'session.end',
      timestamp: this.data.endedAt,
      data: {
        status: this.data.status,
        spanCount: this.completedSpans.length,
      },
    };

    // ── Sampling decision ─────────────────────────────────────────────────
    if (this.isBuffering) {
      const keepFull = shouldSendFull(
        this.samplingConfig,
        statusStr,
        totalDurationMs,
        totalCostCents,
      );

      if (keepFull) {
        // Flush the entire buffer — send every buffered item to the client
        this.flushBuffer();
        // Then send the end-of-session items normally
        this.client.addSession(sessionEndPayload);
        this.client.addEvent(endEvent);
      } else {
        // Discard the buffer; send only a lightweight counter event
        this.buffer = [];
        this.client.sendCounter({
          sessionId: this.data.id,
          status: statusStr,
          spanCount: this.completedSpans.length,
          totalTokens,
          totalCostCents,
          durationMs: totalDurationMs,
          droppedEventCount: this.data.events.length + 2, // +2 for start+end
          timestamp: this.data.endedAt,
        });
      }
    } else {
      // No buffering — emit everything directly
      this.client.addSession(sessionEndPayload);
      this.client.addEvent(endEvent);
    }

    return this.toJSON();
  }

  // ── Events ──────────────────────────────────────────────────────────────

  addEvent(type: string, data: Record<string, unknown>, spanId?: string): void {
    const event: Event = {
      id: randomUUID(),
      sessionId: this.data.id,
      spanId,
      type,
      timestamp: new Date().toISOString(),
      data,
    };
    this.data.events.push(event);

    if (this.isBuffering) {
      this.pushToBuffer({ kind: 'event', payload: event });
    } else {
      this.client.addEvent(event);
    }
  }

  // ── Sampling helpers ──────────────────────────────────────────────────

  /**
   * Push an item to the in-memory buffer.
   * If the buffer exceeds BUFFER_CAP the oldest items are silently dropped.
   */
  private pushToBuffer(item: BufferedItem): void {
    if (this.buffer.length >= BUFFER_CAP) {
      // Drop the oldest item to stay under the cap
      this.buffer.shift();
    }
    this.buffer.push(item);
  }

  /**
   * Flush the entire buffer — replay every buffered item through the client.
   */
  private flushBuffer(): void {
    for (const item of this.buffer) {
      switch (item.kind) {
        case 'session':
          this.client.addSession(item.payload);
          break;
        case 'event':
          this.client.addEvent(item.payload);
          break;
        case 'span':
          this.client.addSpan(item.payload);
          break;
      }
    }
    this.buffer = [];
  }

  // ── Serialization ─────────────────────────────────────────────────────

  toJSON(): SessionData {
    return {
      ...this.data,
      spans: [...this.completedSpans],
    };
  }
}
