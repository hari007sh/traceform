"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  BarChart3,
  Activity,
  AlertTriangle,
  DollarSign,
  Clock,
  AlertCircle,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { AreaChart, LineChart } from "@/components/charts";
import {
  fadeIn,
  staggerContainer,
  staggerItem,
} from "@/lib/animations";
import {
  SkeletonMetricCards,
  SkeletonChart,
  SkeletonTable,
} from "@/components/skeleton";
import { api } from "@/lib/api";
import { useTimeRange } from "@/hooks/use-time-range";

// ---------------------------------------------------------------------------
// Types matching backend response shape for /v1/analytics/overview
// ---------------------------------------------------------------------------

interface AnalyticsOverview {
  total_sessions: number;
  completed_sessions: number;
  failed_sessions: number;
  failure_rate: number;
  reliability_score: number;
  avg_cost_cents: number;
  avg_duration_ms: number;
  total_tokens: number;
  total_cost_cents: number;
  healed_sessions: number;
}

interface TimeSeriesPoint {
  timestamp: string;
  count: number;
}

interface FailureRatePoint {
  timestamp: string;
  total: number;
  failed: number;
  failure_rate: number;
}

interface SessionsOverTimeResponse {
  data: TimeSeriesPoint[];
  start: string;
  end: string;
  interval: number;
}

interface FailureRateResponse {
  data: FailureRatePoint[];
  start: string;
  end: string;
  interval: number;
}

// Agent stats row — derived from sessions data if available
interface AgentStat {
  name: string;
  sessions: number;
  failure_rate: number;
  avg_duration_ms: number;
  avg_cost_cents: number;
  total_cost_cents: number;
}

// Chart data point shape expected by our chart components
interface ChartPoint {
  label: string;
  value: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCost(cents: number): string {
  if (cents >= 100) return `$${(cents / 100).toFixed(2)}`;
  return `$${(cents / 100).toFixed(3)}`;
}

function formatCostLarge(cents: number): string {
  if (cents >= 100000) return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatTimestampLabel(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const { start, end } = useTimeRange();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Real data state — initialized to zeros/empty
  const [metrics, setMetrics] = useState({
    total_sessions: 0,
    avg_duration_ms: 0,
    failure_rate: 0,
    total_cost_cents: 0,
  });
  const [agentStats, setAgentStats] = useState<AgentStat[]>([]);
  const [sessionsChart, setSessionsChart] = useState<ChartPoint[]>([]);
  const [failureChart, setFailureChart] = useState<ChartPoint[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (token) {
      api.setToken(token);
    }

    const interval = 86400; // Daily interval

    try {
      // Fetch analytics overview + time-series data in parallel
      const [overview, sessionsTimeRes, failureRes] = await Promise.all([
        api.get<AnalyticsOverview>(
          `/v1/analytics/overview?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
        ),
        api.get<SessionsOverTimeResponse>(
          `/v1/analytics/sessions-over-time?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&interval=${interval}`
        ).catch(() => ({ data: [] as TimeSeriesPoint[] })),
        api.get<FailureRateResponse>(
          `/v1/analytics/failure-rate?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&interval=${interval}`
        ).catch(() => ({ data: [] as FailureRatePoint[] })),
      ]);

      setMetrics({
        total_sessions: Number(overview.total_sessions),
        avg_duration_ms: Number(overview.avg_duration_ms),
        failure_rate: Number(overview.failure_rate) * 100, // convert 0-1 to percentage
        total_cost_cents: Number(overview.total_cost_cents),
      });

      // Map time-series data to chart format
      const sessionsPts: ChartPoint[] =
        sessionsTimeRes.data && sessionsTimeRes.data.length > 0
          ? sessionsTimeRes.data.map((p) => ({
              label: formatTimestampLabel(p.timestamp),
              value: p.count,
            }))
          : [];
      setSessionsChart(sessionsPts);

      const failurePts: ChartPoint[] =
        failureRes.data && failureRes.data.length > 0
          ? failureRes.data.map((p) => ({
              label: formatTimestampLabel(p.timestamp),
              value: p.failure_rate * 100,
            }))
          : [];
      setFailureChart(failurePts);

      // Try to fetch per-agent breakdown if available
      try {
        const agentsRes = await api.get<{ agents: AgentStat[] }>("/v1/analytics/agents");
        if (agentsRes.agents && agentsRes.agents.length > 0) {
          setAgentStats(
            [...agentsRes.agents].sort((a, b) => b.sessions - a.sessions)
          );
        } else {
          setAgentStats([]);
        }
      } catch {
        // Per-agent endpoint may not exist yet; that's OK — show empty
        setAgentStats([]);
      }
    } catch (err) {
      console.error("[AnalyticsPage] API fetch failed:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load analytics data. Please check your connection and try again."
      );
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const hasData = !loading && !error && metrics.total_sessions > 0;
  const hasChartData = sessionsChart.length > 0 || failureChart.length > 0;
  const isEmpty = !loading && !error && !hasData;

  return (
    <motion.div
      variants={fadeIn}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Aggregate performance and cost analytics across agents
        </p>
      </div>

      {/* Error State */}
      {error && !loading && (
        <div className="rounded-xl border border-[var(--accent-red)]/20 bg-[var(--accent-red)]/5 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-[var(--accent-red)]" />
            <p className="text-sm text-[var(--accent-red)]">{error}</p>
          </div>
          <button
            onClick={fetchData}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      )}

      {/* Metric Cards — always show real values (zeros when empty) */}
      {loading ? (
        <SkeletonMetricCards count={4} />
      ) : !error ? (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          <MetricCard
            title="Total Sessions"
            value={metrics.total_sessions}
            icon={Activity}
            color="blue"
          />
          <MetricCard
            title="Avg Duration"
            value={metrics.avg_duration_ms}
            format="duration"
            icon={Clock}
            color="purple"
          />
          <MetricCard
            title="Failure Rate"
            value={metrics.failure_rate}
            format="percent"
            icon={AlertTriangle}
            color="red"
          />
          <MetricCard
            title="Total Cost"
            value={metrics.total_cost_cents}
            format="currency"
            icon={DollarSign}
            color="green"
          />
        </motion.div>
      ) : null}

      {/* Charts — only when there is real data */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SkeletonChart />
          <SkeletonChart />
        </div>
      ) : hasData ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Sessions Over Time Chart */}
          <div className="rounded-xl glass gradient-border overflow-hidden">
            <div className="relative p-5">
              <div className="relative z-[3]">
                <h3 className="text-[13px] font-medium mb-4 text-[var(--text-primary)]">Sessions Over Time</h3>
                {hasChartData && sessionsChart.length > 0 ? (
                  <AreaChart
                    data={sessionsChart}
                    color="var(--accent-blue)"
                    gradientId="analytics-sessions-area"
                    height={192}
                    formatValue={(v) => v.toLocaleString()}
                  />
                ) : (
                  <div className="h-48 flex items-center justify-center text-[var(--text-tertiary)] text-sm">
                    <div className="text-center">
                      <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p>No session data for this time range</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Failure Rate Trend Chart */}
          <div className="rounded-xl glass gradient-border overflow-hidden">
            <div className="relative p-5">
              <div className="relative z-[3]">
                <h3 className="text-[13px] font-medium mb-4 text-[var(--text-primary)]">Failure Rate Trend</h3>
                {hasChartData && failureChart.length > 0 ? (
                  <LineChart
                    data={failureChart}
                    color="var(--accent-red)"
                    height={192}
                    valueSuffix="%"
                  />
                ) : (
                  <div className="h-48 flex items-center justify-center text-[var(--text-tertiary)] text-sm">
                    <div className="text-center">
                      <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p>No failure data for this time range</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Loading skeleton for table */}
      {loading && <SkeletonTable rows={4} cols={6} />}

      {/* Empty State */}
      {isEmpty && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-16 text-center">
          <div className="w-12 h-12 rounded-xl bg-[var(--accent-blue)]/10 flex items-center justify-center mx-auto mb-4">
            <BarChart3 className="w-6 h-6 text-[var(--accent-blue)]" />
          </div>
          <h3 className="text-sm font-medium mb-2">No analytics data yet</h3>
          <p className="text-xs text-[var(--text-tertiary)] max-w-md mx-auto leading-relaxed mb-6">
            Analytics will populate automatically once agent sessions are
            recorded. Start by instrumenting your agents with the AgentStack SDK.
          </p>
          <div className="flex items-center justify-center gap-3">
            <a
              href="/dashboard/sessions"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-[var(--accent-blue)] text-white hover:bg-[var(--accent-blue)]/90 transition-colors"
            >
              View Sessions
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
            <a
              href="https://docs.agentstack.dev/sdk"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              SDK Docs
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}

      {/* Stats Breakdown by Agent — only with real data */}
      {!loading && agentStats.length > 0 && (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-[var(--border-subtle)]">
            <h3 className="text-[13px] font-medium text-[var(--text-primary)]">Agent Performance</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  {[
                    "Agent",
                    "Total Sessions",
                    "Success Rate",
                    "Failure Rate",
                    "Avg Duration",
                    "Avg Cost",
                    "Total Cost",
                  ].map((header) => (
                    <th
                      key={header}
                      className="text-left px-5 py-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agentStats.map((agent) => {
                  const successRate = Math.max(0, 100 - agent.failure_rate);
                  return (
                    <motion.tr
                      key={agent.name}
                      variants={staggerItem}
                      className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      <td className="px-5 py-3 text-sm font-medium">
                        {agent.name}
                      </td>
                      <td className="px-5 py-3 text-sm text-[var(--text-secondary)] tabular-nums">
                        {agent.sessions.toLocaleString()}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className="text-sm tabular-nums"
                          style={{
                            color:
                              successRate >= 95
                                ? "var(--accent-green)"
                                : successRate >= 90
                                ? "var(--accent-amber)"
                                : "var(--accent-red)",
                          }}
                        >
                          {successRate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className="text-sm tabular-nums"
                          style={{
                            color:
                              agent.failure_rate > 5
                                ? "var(--accent-red)"
                                : agent.failure_rate > 3
                                ? "var(--accent-amber)"
                                : "var(--accent-green)",
                          }}
                        >
                          {agent.failure_rate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-[var(--text-secondary)] tabular-nums">
                        {formatDuration(agent.avg_duration_ms)}
                      </td>
                      <td className="px-5 py-3 text-sm text-[var(--text-secondary)] tabular-nums">
                        {formatCost(agent.avg_cost_cents)}
                      </td>
                      <td className="px-5 py-3 text-sm text-[var(--text-secondary)] tabular-nums">
                        {formatCostLarge(agent.total_cost_cents)}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
