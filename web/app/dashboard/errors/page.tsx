"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import {
  fadeIn,
  staggerContainer,
  staggerItem,
} from "@/lib/animations";
import { SkeletonTable } from "@/components/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { showError, showApiError } from "@/lib/toast";
import { useTimeRange } from "@/hooks/use-time-range";
import { TimeRangePicker } from "@/components/time-range-picker";

// ---------------------------------------------------------------------------
// Types matching backend response
// ---------------------------------------------------------------------------

interface ErrorGroup {
  fingerprint: string;
  sample_error: string;
  occurrence_count: number;
  first_seen: string;
  last_seen: string;
  affected_agents: string[];
}

interface ErrorGroupsResponse {
  groups: ErrorGroup[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(s: string, len: number): string {
  if (s.length <= len) return s;
  return s.slice(0, len) + "...";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ErrorGroupsPage() {
  const [groups, setGroups] = useState<ErrorGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const { start, end } = useTimeRange();

  const initToken = useCallback(() => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (token) {
      api.setToken(token);
    }
    return !!token;
  }, []);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    initToken();

    try {
      const params = new URLSearchParams();
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      const qs = params.toString();
      const data = await api.get<ErrorGroupsResponse>(
        `/v1/errors${qs ? `?${qs}` : ""}`
      );
      setGroups(data.groups || []);
    } catch (err) {
      if (err instanceof ApiError) {
        showApiError(err);
        setError(err.message);
      } else {
        showError("Failed to load error groups");
        setError("Failed to load error groups");
      }
    } finally {
      setLoading(false);
    }
  }, [initToken, start, end]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const toggleRow = (fingerprint: string) => {
    setExpandedRow((prev) => (prev === fingerprint ? null : fingerprint));
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <div className="h-6 w-48 bg-[var(--bg-hover)] rounded animate-pulse" />
          <div className="h-4 w-80 bg-[var(--bg-hover)] rounded animate-pulse mt-2" />
        </div>
        <SkeletonTable rows={5} cols={6} />
      </div>
    );
  }

  return (
    <motion.div
      variants={fadeIn}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            Error Groups
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Deduplicated errors grouped by fingerprint across all agents
          </p>
        </div>
        <div className="flex items-center gap-3">
          <TimeRangePicker />
          <Button variant="outline" size="sm" onClick={fetchGroups}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-[var(--accent-red)]/5 border border-[var(--accent-red)]/10">
          <AlertTriangle className="w-4 h-4 text-[var(--accent-red)] flex-shrink-0" />
          <p className="text-sm text-[var(--text-secondary)]">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchGroups} className="ml-auto">
            Retry
          </Button>
        </div>
      )}

      {/* Table */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden"
      >
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <div className="w-12 h-12 rounded-xl bg-[var(--accent-green)]/10 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-6 h-6 text-[var(--accent-green)]" />
            </div>
            <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
              No errors detected
            </p>
            <p className="text-xs text-[var(--text-tertiary)] text-center max-w-xs">
              No errors have been recorded for the selected time range. Your
              agents are running cleanly.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="text-left px-5 py-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                    Fingerprint
                  </th>
                  <th className="text-left px-5 py-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                    Error Message
                  </th>
                  <th className="text-right px-5 py-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                    Count
                  </th>
                  <th className="text-left px-5 py-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                    First Seen
                  </th>
                  <th className="text-left px-5 py-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                    Last Seen
                  </th>
                  <th className="text-left px-5 py-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                    Affected Agents
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const isExpanded = expandedRow === group.fingerprint;
                  return (
                    <motion.tr
                      key={group.fingerprint}
                      variants={staggerItem}
                      className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                      onClick={() => toggleRow(group.fingerprint)}
                    >
                      <td className="px-5 py-3.5 align-top">
                        <div className="flex items-center gap-2">
                          <ChevronDown
                            className={`w-3.5 h-3.5 text-[var(--text-tertiary)] transition-transform ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                          />
                          <code className="font-mono text-xs text-[var(--accent-blue)]">
                            {group.fingerprint.slice(0, 8)}
                          </code>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 align-top">
                        <div>
                          <p className="text-sm text-[var(--text-primary)]">
                            {truncate(group.sample_error, 80)}
                          </p>
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="overflow-hidden"
                              >
                                <pre className="mt-2 p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                                  {group.sample_error}
                                </pre>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right align-top">
                        <span className="text-sm font-medium tabular-nums text-[var(--text-primary)]">
                          {group.occurrence_count.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-[var(--text-secondary)] align-top">
                        {formatDate(group.first_seen)}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-[var(--text-secondary)] align-top">
                        {formatDate(group.last_seen)}
                      </td>
                      <td className="px-5 py-3.5 align-top">
                        <div className="flex flex-wrap gap-1">
                          {(group.affected_agents || []).map((agent) => (
                            <Badge
                              key={agent}
                              className="bg-[var(--bg-hover)] text-[var(--text-secondary)] border-0 text-[10px]"
                            >
                              {agent}
                            </Badge>
                          ))}
                          {(!group.affected_agents ||
                            group.affected_agents.length === 0) && (
                            <span className="text-xs text-[var(--text-tertiary)]">
                              --
                            </span>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
