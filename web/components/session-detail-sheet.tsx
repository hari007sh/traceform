"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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

interface SessionDetailSheetProps {
  sessionId: string | null;
  onClose: () => void;
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

function formatDuration(ms: number): string {
  if (ms === 0) return "\u2014";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionDetailSheet({ sessionId, onClose }: SessionDetailSheetProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [spans, setSpans] = useState<Span[]>([]);
  const [events, setEvents] = useState<SessionEvent[]>([]);

  const fetchData = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);

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
        setError(err.status === 404 ? "Session not found." : err.message || "Failed to load session.");
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
      // Reset state when sheet closes
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

  const depths = useMemo(() => computeDepths(orderedSpans), [orderedSpans]);

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
        .filter((e) => e.type === "healing" || e.type === "healing_intervention")
        .map((e) => ({
          id: e.id,
          timestamp: e.created_at,
          intervention_type: e.name || e.type,
          description: e.data || "",
        })),
    [events]
  );

  const maxDuration = session?.duration_ms ?? 0;

  return (
    <Sheet open={!!sessionId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-[65vw] max-w-[900px] sm:max-w-[900px] p-0 bg-[var(--bg-primary)] border-l border-[var(--border-subtle)] overflow-y-auto"
      >
        <div className="p-6 space-y-5">
          {/* Header */}
          <SheetHeader className="space-y-1">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-lg font-semibold text-[var(--text-primary)]">
                Session Detail
              </SheetTitle>
              {sessionId && (
                <Link
                  href={`/dashboard/sessions/${sessionId}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--accent-blue)] bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/20 hover:bg-[var(--accent-blue)]/15 transition-colors"
                >
                  Open Full View
                  <ExternalLink className="w-3 h-3" />
                </Link>
              )}
            </div>
            <SheetDescription className="text-sm text-[var(--text-tertiary)]">
              {sessionId ? (
                <span className="font-mono text-xs">{sessionId}</span>
              ) : (
                "Select a session to view details"
              )}
            </SheetDescription>
          </SheetHeader>

          {/* Loading State */}
          {loading && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
                <div className="flex gap-4 mb-4">
                  <SkeletonBlock className="h-5 w-28" />
                  <SkeletonBlock className="h-5 w-16" />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <SkeletonBlock className="h-4 w-20" />
                  <SkeletonBlock className="h-4 w-20" />
                  <SkeletonBlock className="h-4 w-20" />
                </div>
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
          )}

          {/* Error State */}
          {!loading && error && (
            <div className="rounded-xl border border-[var(--accent-red)]/20 bg-[var(--accent-red)]/5 p-5">
              <div className="flex items-center gap-3 mb-3">
                <AlertCircle className="w-5 h-5 text-[var(--accent-red)]" />
                <h3 className="text-sm font-medium text-[var(--accent-red)]">
                  Failed to load session
                </h3>
              </div>
              <p className="text-sm text-[var(--text-secondary)] mb-3">{error}</p>
              <button
                onClick={() => sessionId && fetchData(sessionId)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs font-medium hover:bg-[var(--bg-hover)] transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </button>
            </div>
          )}

          {/* Session Data */}
          {!loading && !error && session && (
            <>
              {/* Metadata Card */}
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="text-sm font-semibold font-mono text-[var(--text-primary)] truncate">
                    {session.agent_name}
                  </h2>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium capitalize ${statusBadgeClass[session.status] || ""}`}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: statusColors[session.status] }}
                    />
                    {session.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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
                </div>

                <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-1">
                    Started
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {new Date(session.started_at).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Session Replay Gantt Chart */}
              {orderedSpans.length > 0 && (
                <SessionReplay spans={replaySpans} healingMarkers={healingMarkers} />
              )}

              {/* Span List */}
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
                  <h3 className="text-sm font-medium text-[var(--text-primary)]">Spans</h3>
                  <span className="text-xs text-[var(--text-tertiary)]">
                    {orderedSpans.length} span{orderedSpans.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {orderedSpans.length === 0 ? (
                  <div className="p-8 text-center">
                    <Cpu className="w-5 h-5 text-[var(--accent-purple)] mx-auto mb-2 opacity-50" />
                    <p className="text-xs text-[var(--text-tertiary)]">
                      No spans recorded
                    </p>
                  </div>
                ) : (
                  <div className="max-h-[400px] overflow-y-auto">
                    {orderedSpans.map((span) => {
                      const depth = depths.get(span.id) || 0;
                      const SpanTypeIcon = spanTypeIcons[span.span_type] || Zap;
                      const StatusIcon = spanStatusIcons[span.status] || CheckCircle2;
                      const barWidth =
                        maxDuration > 0
                          ? Math.max(4, (span.duration_ms / maxDuration) * 100)
                          : 4;

                      return (
                        <div
                          key={span.id}
                          className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors px-4 py-2.5"
                        >
                          <div className="flex items-center gap-2.5">
                            {/* Indentation */}
                            {depth > 0 && (
                              <div
                                style={{ width: depth * 16 }}
                                className="flex-shrink-0"
                              />
                            )}

                            {/* Type icon */}
                            <div
                              className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${spanTypeColors[span.span_type]}`}
                            >
                              <SpanTypeIcon className="w-3 h-3" />
                            </div>

                            {/* Name */}
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

                            {/* Duration */}
                            <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums flex-shrink-0 w-12 text-right">
                              {formatDuration(span.duration_ms)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
