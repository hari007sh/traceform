"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Clock,
  Coins,
  Hash,
  Bot,
  Cpu,
  Wrench,
  Database,
  Link2,
  Zap,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Timer,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  MousePointerClick,
} from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { SessionReplay } from "@/components/session-replay";
import type { SpanData, HealingMarker } from "@/components/session-replay";
import { Badge } from "@/components/ui/badge";
import { SkeletonBlock } from "@/components/skeleton";
import { api, ApiError } from "@/lib/api";
import type { Session, Span } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionEvent {
  id: string;
  session_id: string;
  span_id?: string;
  org_id: string;
  type: string;
  name: string;
  data: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const statusColors: Record<string, string> = {
  completed: "var(--accent-green)",
  failed: "var(--accent-red)",
  running: "var(--accent-blue)",
  timeout: "var(--accent-amber)",
  healed: "var(--healing-blue)",
};

const statusBadgeClass: Record<string, string> = {
  completed:
    "bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20",
  failed:
    "bg-[var(--accent-red)]/10 text-[var(--accent-red)] border border-[var(--accent-red)]/20",
  running:
    "bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] border border-[var(--accent-blue)]/20",
  timeout:
    "bg-[var(--accent-amber)]/10 text-[var(--accent-amber)] border border-[var(--accent-amber)]/20",
  healed:
    "bg-[var(--healing-blue)]/10 text-[var(--healing-blue)] border border-[var(--healing-blue)]/20",
};

const spanTypeIcons: Record<string, React.ElementType> = {
  agent: Bot,
  llm_call: Cpu,
  tool_call: Wrench,
  retrieval: Database,
  chain: Link2,
  custom: Zap,
};

const spanTypeColors: Record<string, string> = {
  agent: "bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]",
  llm_call: "bg-[var(--accent-purple)]/10 text-[var(--accent-purple)]",
  tool_call: "bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]",
  retrieval: "bg-[var(--accent-green)]/10 text-[var(--accent-green)]",
  chain: "bg-[var(--healing-blue)]/10 text-[var(--healing-blue)]",
  custom: "bg-[var(--text-tertiary)]/10 text-[var(--text-tertiary)]",
};

const spanStatusIcons: Record<string, React.ElementType> = {
  completed: CheckCircle2,
  failed: XCircle,
  running: Timer,
  timeout: AlertCircle,
};

function computeDepths(spans: Span[]): Map<string, number> {
  const depthMap = new Map<string, number>();
  const spanMap = new Map(spans.map((s) => [s.id, s]));

  function depth(id: string): number {
    if (depthMap.has(id)) return depthMap.get(id)!;
    const span = spanMap.get(id);
    if (!span?.parent_id || !spanMap.has(span.parent_id)) {
      depthMap.set(id, 0);
      return 0;
    }
    const d = 1 + depth(span.parent_id);
    depthMap.set(id, d);
    return d;
  }

  spans.forEach((s) => depth(s.id));
  return depthMap;
}

function formatDuration(ms: number): string {
  if (ms === 0) return "\u2014";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center px-8">
      <div className="w-14 h-14 rounded-2xl bg-[var(--bg-hover)] flex items-center justify-center mb-4">
        <MousePointerClick className="w-7 h-7 text-[var(--text-tertiary)]" />
      </div>
      <h3 className="text-sm font-medium text-[var(--text-primary)] mb-1">
        Select a session
      </h3>
      <p className="text-xs text-[var(--text-tertiary)] max-w-[240px]">
        Click on a session in the list to view its details, spans, and timeline.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function DetailSkeleton() {
  return (
    <div className="p-6 space-y-5">
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
        <div className="flex gap-4 mb-4">
          <SkeletonBlock className="h-5 w-28" />
          <SkeletonBlock className="h-5 w-16" />
        </div>
        <div className="grid grid-cols-4 gap-4">
          <SkeletonBlock className="h-4 w-20" />
          <SkeletonBlock className="h-4 w-20" />
          <SkeletonBlock className="h-4 w-20" />
          <SkeletonBlock className="h-4 w-20" />
        </div>
      </div>
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
        <SkeletonBlock className="h-4 w-24 mb-4" />
        <SkeletonBlock className="h-32 w-full" />
      </div>
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
        <SkeletonBlock className="h-4 w-24 mb-4" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 mb-3">
            <SkeletonBlock className="h-7 w-7 rounded-lg" />
            <SkeletonBlock className="h-4 w-40" />
            <div className="flex-1" />
            <SkeletonBlock className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SessionDetailPanelProps {
  sessionId: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionDetailPanel({ sessionId }: SessionDetailPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [spans, setSpans] = useState<Span[]>([]);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [expandedPayloads, setExpandedPayloads] = useState<
    Record<string, string>
  >({});

  // Track which spans have collapsed subtrees
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const fetchFullPayload = async (spanId: string, field: "input" | "output") => {
    const token = localStorage.getItem("token");
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/v1/spans/${spanId}/payload?field=${field}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return;
    const data = await res.json();
    setExpandedPayloads((prev) => ({
      ...prev,
      [`${spanId}-${field}`]: data.payload,
    }));
  };

  const fetchData = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setCollapsed(new Set());
    setExpandedPayloads({});

    try {
      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("token")
          : null;
      if (token) {
        api.setToken(token);
      }

      const [sessionRes, spansRes, eventsRes] = await Promise.all([
        api.get<Session>(`/v1/sessions/${id}`),
        api.get<{ spans: Span[] }>(`/v1/sessions/${id}/spans`),
        api.get<{ events: SessionEvent[] }>(`/v1/sessions/${id}/events`),
      ]);

      setSession(sessionRes);
      setSpans(spansRes.spans ?? []);
      setEvents(eventsRes.events ?? []);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.status === 404
            ? "Session not found."
            : err.message || "Failed to load session."
        );
      } else {
        setError("An unexpected error occurred.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionId) {
      fetchData(sessionId);
    } else {
      setSession(null);
      setSpans([]);
      setEvents([]);
      setError(null);
    }
  }, [sessionId, fetchData]);

  // Order spans by start time
  const orderedSpans = useMemo(
    () =>
      [...spans].sort(
        (a, b) =>
          new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
      ),
    [spans]
  );

  // O(N) depth map
  const depths = useMemo(() => computeDepths(orderedSpans), [orderedSpans]);

  // Track which spans have children
  const hasChildren = useMemo(() => {
    const set = new Set<string>();
    orderedSpans.forEach((s) => {
      if (s.parent_id) set.add(s.parent_id);
    });
    return set;
  }, [orderedSpans]);

  // Filter out children of collapsed parents
  const visibleSpans = useMemo(() => {
    const spanMap = new Map(orderedSpans.map((s) => [s.id, s]));
    return orderedSpans.filter((span) => {
      let parentId = span.parent_id;
      while (parentId) {
        if (collapsed.has(parentId)) return false;
        const parent = spanMap.get(parentId);
        parentId = parent?.parent_id || "";
        if (!parentId) break;
      }
      return true;
    });
  }, [orderedSpans, collapsed]);

  const toggleCollapse = useCallback((spanId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) {
        next.delete(spanId);
      } else {
        next.add(spanId);
      }
      return next;
    });
  }, []);

  // Map Span[] -> SpanData[] for SessionReplay
  const replaySpans: SpanData[] = useMemo(
    () =>
      orderedSpans.map((s) => ({
        id: s.id,
        name: s.name,
        span_type: s.span_type,
        start_time: s.started_at,
        end_time: s.ended_at,
        parent_id: s.parent_id || null,
        model: s.model || undefined,
        tokens:
          s.input_tokens || s.output_tokens
            ? { input: s.input_tokens, output: s.output_tokens }
            : undefined,
        status: s.status === "timeout" ? "completed" : s.status,
      })),
    [orderedSpans]
  );

  // Map healing events -> HealingMarker[]
  const healingMarkers: HealingMarker[] = useMemo(
    () =>
      events
        .filter(
          (e) => e.type === "healing" || e.type === "healing_intervention"
        )
        .map((e) => ({
          id: e.id,
          timestamp: e.created_at,
          intervention_type: e.name || e.type,
          description: e.data || "",
        })),
    [events]
  );

  // Ordered events for timeline
  const orderedEvents = useMemo(
    () =>
      [...events].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ),
    [events]
  );

  const maxDuration = session?.duration_ms ?? 0;

  // No session selected
  if (!sessionId) {
    return <EmptyState />;
  }

  // Loading
  if (loading) {
    return <DetailSkeleton />;
  }

  // Error
  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-[var(--accent-red)]/20 bg-[var(--accent-red)]/5 p-5">
          <div className="flex items-center gap-3 mb-3">
            <AlertCircle className="w-5 h-5 text-[var(--accent-red)]" />
            <h3 className="text-sm font-medium text-[var(--accent-red)]">
              Failed to load session
            </h3>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mb-3">{error}</p>
          <button
            onClick={() => fetchData(sessionId)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs font-medium hover:bg-[var(--bg-hover)] transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <motion.div
      key={sessionId}
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="p-6 space-y-5 overflow-y-auto h-full"
    >
      {/* Header card */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">
              {session.agent_name}
            </h2>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium capitalize flex-shrink-0 ${statusBadgeClass[session.status] || ""}`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: statusColors[session.status] }}
              />
              {session.status}
            </span>
          </div>
          <Link
            href={`/dashboard/sessions/${sessionId}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--accent-blue)] bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/20 hover:bg-[var(--accent-blue)]/15 transition-colors flex-shrink-0"
          >
            Open Full View
            <ExternalLink className="w-3 h-3" />
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-1">
              Duration
            </p>
            <p className="text-sm flex items-center gap-1.5 text-[var(--text-primary)]">
              <Clock className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
              {formatDuration(session.duration_ms)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-1">
              Cost
            </p>
            <p className="text-sm flex items-center gap-1.5 text-[var(--text-primary)]">
              <Coins className="w-3.5 h-3.5 text-[var(--accent-green)]" />
              {formatCost(session.total_cost_cents)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-1">
              Tokens
            </p>
            <p className="text-sm flex items-center gap-1.5 text-[var(--text-primary)]">
              <Hash className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
              {session.total_tokens.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-1">
              Spans
            </p>
            <p className="text-sm text-[var(--text-primary)]">
              {session.total_spans}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-1">
              Started
            </p>
            <p className="text-xs text-[var(--text-secondary)]">
              {new Date(session.started_at).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Session ID */}
        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-1">
            Session ID
          </p>
          <p className="text-xs text-[var(--text-secondary)] font-mono">
            {session.id}
          </p>
        </div>
      </div>

      {/* Session Replay Gantt Chart */}
      {orderedSpans.length > 0 && (
        <SessionReplay spans={replaySpans} healingMarkers={healingMarkers} />
      )}

      {/* Span Tree */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">
            Span Timeline
          </h3>
          {orderedSpans.length > 0 && (
            <span className="text-xs text-[var(--text-tertiary)]">
              {visibleSpans.length} of {orderedSpans.length} spans
            </span>
          )}
        </div>

        {orderedSpans.length === 0 ? (
          <div className="p-10 text-center">
            <div className="w-10 h-10 rounded-xl bg-[var(--accent-purple)]/10 flex items-center justify-center mx-auto mb-3">
              <Cpu className="w-5 h-5 text-[var(--accent-purple)]" />
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              No spans recorded for this session.
            </p>
          </div>
        ) : (
          <div
            style={{ height: Math.min(visibleSpans.length * 72, 500) }}
          >
            <Virtuoso
              data={visibleSpans}
              itemContent={(_index, span) => {
                const depth = depths.get(span.id) || 0;
                const SpanTypeIcon = spanTypeIcons[span.span_type] || Zap;
                const StatusIcon =
                  spanStatusIcons[span.status] || CheckCircle2;
                const barWidth =
                  maxDuration > 0
                    ? Math.max(4, (span.duration_ms / maxDuration) * 100)
                    : 4;
                const isCollapsed = collapsed.has(span.id);
                const isParent = hasChildren.has(span.id);

                return (
                  <div className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors">
                    <div className="flex items-center gap-2.5 px-4 py-2.5">
                      {/* Indentation */}
                      <div
                        style={{ width: depth * 20 }}
                        className="flex-shrink-0"
                      />

                      {/* Collapse toggle */}
                      <button
                        onClick={() => isParent && toggleCollapse(span.id)}
                        className={`w-4 h-4 flex items-center justify-center flex-shrink-0 transition-transform ${
                          isParent
                            ? "text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                            : "text-transparent cursor-default"
                        }`}
                        style={{
                          transform:
                            isParent && !isCollapsed
                              ? "rotate(90deg)"
                              : "rotate(0deg)",
                        }}
                        aria-label={
                          isParent
                            ? isCollapsed
                              ? "Expand"
                              : "Collapse"
                            : undefined
                        }
                      >
                        {isParent && (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {/* Type Icon */}
                      <div
                        className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${spanTypeColors[span.span_type]}`}
                      >
                        <SpanTypeIcon className="w-3 h-3" />
                      </div>

                      {/* Name + Type */}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                          {span.name}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Badge
                            variant="outline"
                            className="text-[9px] px-1 py-0 h-3.5 border-[var(--border-subtle)]"
                          >
                            {span.span_type.replace("_", " ")}
                          </Badge>
                          {span.model && (
                            <span className="text-[9px] text-[var(--text-tertiary)]">
                              {span.model}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Status */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <StatusIcon
                          className="w-3 h-3"
                          style={{
                            color:
                              span.status === "completed"
                                ? "var(--accent-green)"
                                : span.status === "failed"
                                  ? "var(--accent-red)"
                                  : span.status === "running"
                                    ? "var(--accent-blue)"
                                    : "var(--accent-amber)",
                          }}
                        />
                      </div>

                      {/* Duration bar + value */}
                      <div className="w-28 flex-shrink-0">
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${barWidth}%`,
                                backgroundColor:
                                  span.span_type === "llm_call"
                                    ? "var(--accent-purple)"
                                    : span.span_type === "tool_call"
                                      ? "var(--accent-amber)"
                                      : span.span_type === "agent"
                                        ? "var(--accent-blue)"
                                        : span.span_type === "retrieval"
                                          ? "var(--accent-green)"
                                          : "var(--healing-blue)",
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-[var(--text-tertiary)] w-12 text-right flex-shrink-0 tabular-nums">
                            {formatDuration(span.duration_ms)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Input / Output Payload */}
                    {(span.input || span.output) && (
                      <div
                        className="px-4 pb-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2"
                        style={{
                          paddingLeft: `${depth * 20 + 16 + 16 + 24 + 10}px`,
                        }}
                      >
                        {span.input && (
                          <div>
                            <p className="text-[9px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-1">
                              Input
                            </p>
                            <pre className="text-[10px] text-[var(--text-secondary)] whitespace-pre-wrap break-all max-h-32 overflow-auto rounded-md bg-[var(--bg-primary)] border border-[var(--border-subtle)] p-1.5 font-mono">
                              {expandedPayloads[`${span.id}-input`] ||
                                span.input}
                            </pre>
                            {span.input_truncated &&
                              !expandedPayloads[`${span.id}-input`] && (
                                <button
                                  onClick={() =>
                                    fetchFullPayload(span.id, "input")
                                  }
                                  className="text-[10px] text-[var(--accent-blue)] hover:text-[var(--accent-blue)]/80 mt-0.5 font-medium"
                                >
                                  Show full input
                                </button>
                              )}
                          </div>
                        )}
                        {span.output && (
                          <div>
                            <p className="text-[9px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-1">
                              Output
                            </p>
                            <pre className="text-[10px] text-[var(--text-secondary)] whitespace-pre-wrap break-all max-h-32 overflow-auto rounded-md bg-[var(--bg-primary)] border border-[var(--border-subtle)] p-1.5 font-mono">
                              {expandedPayloads[`${span.id}-output`] ||
                                span.output}
                            </pre>
                            {span.output_truncated &&
                              !expandedPayloads[`${span.id}-output`] && (
                                <button
                                  onClick={() =>
                                    fetchFullPayload(span.id, "output")
                                  }
                                  className="text-[10px] text-[var(--accent-blue)] hover:text-[var(--accent-blue)]/80 mt-0.5 font-medium"
                                >
                                  Show full output
                                </button>
                              )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              }}
            />
          </div>
        )}
      </div>

      {/* Events Timeline */}
      {orderedEvents.length > 0 && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--border-subtle)]">
            <h3 className="text-sm font-medium text-[var(--text-primary)]">
              Events
            </h3>
          </div>
          <div className="p-5">
            <div className="relative">
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[var(--border-subtle)]" />
              <div className="space-y-3">
                {orderedEvents.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-start gap-3 relative"
                  >
                    <div className="w-[15px] h-[15px] rounded-full border-2 border-[var(--border-default)] bg-[var(--bg-elevated)] flex-shrink-0 mt-0.5 z-10" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[var(--text-secondary)]">
                        <span className="text-[var(--text-primary)] font-medium">
                          {event.name || event.type}
                        </span>
                        {event.data && (
                          <span className="ml-2 text-[var(--text-tertiary)]">
                            {event.data}
                          </span>
                        )}
                      </p>
                      <p className="text-[9px] text-[var(--text-tertiary)] mt-0.5 font-mono">
                        {formatTimestamp(event.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
