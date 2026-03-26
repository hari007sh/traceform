"use client";

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  Activity,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  AlertTriangle,
  Copy,
  Check,
  ExternalLink,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { fadeIn, staggerContainer, staggerItem } from "@/lib/animations";
import { SkeletonTable } from "@/components/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import type { Session } from "@/lib/types";

// ---------------------------------------------------------------------------
// API response shape from GET /v1/sessions (with meta)
// ---------------------------------------------------------------------------
interface SessionsMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

interface SessionsAPIResponse {
  sessions: Session[];
  total: number;
  limit: number;
  offset: number;
  meta: SessionsMeta;
}

// ---------------------------------------------------------------------------
// Display type -- the Session plus a computed time_ago string
// ---------------------------------------------------------------------------
type DisplaySession = Session & { time_ago: string };

// ---------------------------------------------------------------------------
// Relative-time formatter
// ---------------------------------------------------------------------------
function formatTimeAgo(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Map API sessions to display sessions
// ---------------------------------------------------------------------------
function toDisplaySessions(sessions: Session[]): DisplaySession[] {
  return sessions.map((s) => ({
    ...s,
    tags: s.tags ?? [],
    time_ago: formatTimeAgo(s.started_at),
  }));
}

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const statusConfig: Record<
  string,
  { color: string; bgClass: string; dotClass: string }
> = {
  completed: {
    color: "var(--accent-green)",
    bgClass:
      "bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20",
    dotClass: "",
  },
  failed: {
    color: "var(--accent-red)",
    bgClass:
      "bg-[var(--accent-red)]/10 text-[var(--accent-red)] border border-[var(--accent-red)]/20",
    dotClass: "status-failed",
  },
  running: {
    color: "var(--accent-blue)",
    bgClass:
      "bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] border border-[var(--accent-blue)]/20",
    dotClass: "animate-pulse",
  },
  timeout: {
    color: "var(--accent-amber)",
    bgClass:
      "bg-[var(--accent-amber)]/10 text-[var(--accent-amber)] border border-[var(--accent-amber)]/20",
    dotClass: "",
  },
  healed: {
    color: "var(--healing-blue)",
    bgClass:
      "bg-[var(--healing-blue)]/10 text-[var(--healing-blue)] border border-[var(--healing-blue)]/20",
    dotClass: "status-healed",
  },
};

function formatDuration(ms: number): string {
  if (ms === 0) return "\u2014";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return tokens.toLocaleString();
}

// ---------------------------------------------------------------------------
// Copy button helper
// ---------------------------------------------------------------------------

function CopyButton({ text, label = "Copy Setup Code", className = "" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
        copied
          ? "text-[var(--accent-green)] bg-[var(--accent-green)]/10 border border-[var(--accent-green)]/20"
          : "text-[var(--text-secondary)] bg-[var(--bg-hover)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]"
      } ${className}`}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied!" : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Empty state component for sessions page
// ---------------------------------------------------------------------------

const SETUP_CODE = `import agentstack
agentstack.init(api_key="your-key", endpoint="http://localhost:8080")

with agentstack.session(agent_name="my-agent") as session:
    # Your agent code here
    pass`;

function EmptySessionsState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-10 lg:p-14"
    >
      <div className="flex flex-col items-center text-center max-w-lg mx-auto">
        <div className="w-12 h-12 rounded-xl bg-[var(--accent-blue)]/10 flex items-center justify-center mb-4">
          <Activity className="w-6 h-6 text-[var(--accent-blue)]" />
        </div>
        <h3 className="text-[15px] font-semibold text-[var(--text-primary)] mb-1.5">
          No sessions recorded
        </h3>
        <p className="text-[13px] text-[var(--text-secondary)] mb-6">
          Start sending trace data from your agents to see sessions here.
        </p>

        {/* Code snippet */}
        <div className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)] overflow-hidden mb-5">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)]">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
              Python
            </span>
            <CopyButton text={SETUP_CODE} label="Copy" />
          </div>
          <pre className="px-4 py-3 text-[12px] leading-relaxed font-mono text-[var(--text-secondary)] text-left overflow-x-auto">
            <code>
              <span className="text-[var(--accent-purple)]">import</span> agentstack{"\n"}
              agentstack.<span className="text-[var(--accent-blue)]">init</span>(api_key=<span className="text-[var(--accent-green)]">&quot;your-key&quot;</span>, endpoint=<span className="text-[var(--accent-green)]">&quot;http://localhost:8080&quot;</span>){"\n"}
              {"\n"}
              <span className="text-[var(--accent-purple)]">with</span> agentstack.<span className="text-[var(--accent-blue)]">session</span>(agent_name=<span className="text-[var(--accent-green)]">&quot;my-agent&quot;</span>) <span className="text-[var(--accent-purple)]">as</span> session:{"\n"}
              {"    "}<span className="text-[var(--text-tertiary)]"># Your agent code here</span>{"\n"}
              {"    "}<span className="text-[var(--accent-purple)]">pass</span>
            </code>
          </pre>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          <CopyButton text={SETUP_CODE} label="Copy Setup Code" />
          <a
            href="https://docs.agentstack.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-[var(--accent-blue)] bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/20 hover:bg-[var(--accent-blue)]/15 transition-colors"
          >
            View Docs
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Debounce hook
// ---------------------------------------------------------------------------

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// ---------------------------------------------------------------------------
// Sortable column header definitions
// ---------------------------------------------------------------------------

interface ColumnDef {
  label: string;
  sortKey?: string; // undefined = not sortable
}

const columns: ColumnDef[] = [
  { label: "Session" },
  { label: "Agent", sortKey: "agent_name" },
  { label: "Status", sortKey: "status" },
  { label: "Duration", sortKey: "duration_ms" },
  { label: "Tokens", sortKey: "total_tokens" },
  { label: "Cost", sortKey: "total_cost_cents" },
  { label: "Time", sortKey: "started_at" },
];

// ---------------------------------------------------------------------------
// Compact paginator with ellipsis
// ---------------------------------------------------------------------------

function getPageNumbers(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | "ellipsis")[] = [];

  // Always show first page
  pages.push(1);

  if (current <= 3) {
    // Near the start: 1 2 3 4 ... last
    pages.push(2, 3, 4, "ellipsis", total);
  } else if (current >= total - 2) {
    // Near the end: 1 ... last-3 last-2 last-1 last
    pages.push("ellipsis", total - 3, total - 2, total - 1, total);
  } else {
    // Middle: 1 ... curr-1 curr curr+1 ... last
    pages.push("ellipsis", current - 1, current, current + 1, "ellipsis", total);
  }

  return pages;
}

// ---------------------------------------------------------------------------
// Page size options
// ---------------------------------------------------------------------------
const PAGE_SIZE_OPTIONS = [25, 50, 100];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

function SessionsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ---------------------------------------------------------------------------
  // Derive state from URL search params (single source of truth)
  // ---------------------------------------------------------------------------
  const page = parseInt(searchParams.get("page") || "1", 10) || 1;
  const perPage = parseInt(searchParams.get("per_page") || "50", 10) || 50;
  const statusFilter = searchParams.get("status") || "all";
  const sortBy = searchParams.get("sort_by") || "started_at";
  const sortDir = searchParams.get("sort_dir") || "desc";
  const searchParam = searchParams.get("search") || "";

  // Local search input value (not yet debounced)
  const [searchInput, setSearchInput] = useState(searchParam);
  const debouncedSearch = useDebounce(searchInput, 300);

  // API data
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<DisplaySession[]>([]);
  const [meta, setMeta] = useState<SessionsMeta>({
    page: 1,
    per_page: 50,
    total: 0,
    total_pages: 1,
  });
  const [refreshing, setRefreshing] = useState(false);

  // Abort controller ref
  const abortRef = useRef<AbortController | null>(null);

  // ---------------------------------------------------------------------------
  // URL param update helper -- replaces searchParams without full navigation
  // ---------------------------------------------------------------------------
  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "" || value === "all") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      // Reset to page 1 unless page is explicitly in the update
      if (!("page" in updates)) {
        params.delete("page");
      }
      const qs = params.toString();
      router.replace(`/dashboard/sessions${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [searchParams, router]
  );

  // ---------------------------------------------------------------------------
  // Sync debounced search -> URL params
  // ---------------------------------------------------------------------------
  const prevDebouncedSearch = useRef(searchParam);
  useEffect(() => {
    if (debouncedSearch !== prevDebouncedSearch.current) {
      prevDebouncedSearch.current = debouncedSearch;
      updateParams({ search: debouncedSearch || null });
    }
  }, [debouncedSearch, updateParams]);

  // ---------------------------------------------------------------------------
  // Build API URL from search params
  // ---------------------------------------------------------------------------
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("per_page", String(perPage));
    if (searchParam) params.set("search", searchParam);
    if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
    if (sortBy) params.set("sort_by", sortBy);
    if (sortDir) params.set("sort_dir", sortDir);
    return `/v1/sessions?${params.toString()}`;
  }, [page, perPage, searchParam, statusFilter, sortBy, sortDir]);

  // ---------------------------------------------------------------------------
  // Fetch sessions from API
  // ---------------------------------------------------------------------------
  const fetchSessions = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setFetchError(null);

    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      if (token) {
        api.setToken(token);
      }

      const data = await api.get<SessionsAPIResponse>(apiUrl);

      if (controller.signal.aborted) return;

      const displaySessions = toDisplaySessions(data.sessions ?? []);
      setSessions(displaySessions);
      setMeta(
        data.meta || {
          page: 1,
          per_page: perPage,
          total: data.total || 0,
          total_pages: Math.max(1, Math.ceil((data.total || 0) / perPage)),
        }
      );
      setLoading(false);
    } catch (err) {
      if (controller.signal.aborted) return;

      const message =
        err instanceof ApiError
          ? `${err.message} (${err.code})`
          : err instanceof Error
            ? err.message
            : "Failed to load sessions";

      console.error("[AgentStack] SessionsPage: API fetch failed:", message);
      setFetchError(message);
      setLoading(false);
    }
  }, [apiUrl, perPage]);

  useEffect(() => {
    fetchSessions();
    return () => {
      abortRef.current?.abort();
    };
  }, [fetchSessions]);

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------
  const handleRefresh = () => {
    setRefreshing(true);
    fetchSessions().finally(() => {
      setTimeout(() => setRefreshing(false), 400);
    });
  };

  const handleStatusChange = (status: string) => {
    updateParams({ status: status === "all" ? null : status });
  };

  const handleSort = (column: string) => {
    if (column === sortBy) {
      // Toggle direction
      updateParams({
        sort_by: column,
        sort_dir: sortDir === "desc" ? "asc" : "desc",
        page: String(page), // preserve current page on sort
      });
    } else {
      updateParams({ sort_by: column, sort_dir: "desc" });
    }
  };

  const handlePageChange = (newPage: number) => {
    updateParams({ page: String(newPage) });
  };

  const handlePerPageChange = (newPerPage: number) => {
    updateParams({ per_page: String(newPerPage) });
    // page resets to 1 automatically since "page" is not in updates
  };

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------
  const totalPages = meta.total_pages;
  const isEmptyState = !loading && !fetchError && meta.total === 0 && !searchParam && statusFilter === "all";
  const isNoResults = !loading && !fetchError && sessions.length === 0 && !isEmptyState;

  const pageNumbers = getPageNumbers(page, totalPages);

  return (
    <motion.div
      variants={fadeIn}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Sessions</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Browse and inspect agent execution sessions
        </p>
      </div>

      {/* Search / Filter Bar */}
      <div className={`flex flex-col sm:flex-row gap-3 ${isEmptyState ? "opacity-50 pointer-events-none" : ""}`}>
        <div className="relative flex-1 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
            <Input
              placeholder="Search by agent name or session ID..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-10 bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-sm"
              disabled={isEmptyState}
            />
          </div>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleRefresh}
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] transition-colors flex-shrink-0"
            title="Refresh"
            disabled={isEmptyState}
          >
            <RefreshCw
              className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
            />
          </motion.button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {["all", "completed", "failed", "running", "timeout", "healed"].map(
            (status) => {
              const isActive = statusFilter === status;
              const config = status !== "all" ? statusConfig[status] : null;
              return (
                <button
                  key={status}
                  onClick={() => handleStatusChange(status)}
                  disabled={isEmptyState}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-all duration-150 capitalize ${
                    isActive
                      ? status === "all"
                        ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]"
                        : config?.bgClass || ""
                      : "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  {status !== "all" && (
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
                      style={{
                        backgroundColor: config?.color,
                      }}
                    />
                  )}
                  {status}
                </button>
              );
            }
          )}
        </div>
      </div>

      {/* Loading State */}
      {loading && <SkeletonTable rows={6} cols={7} />}

      {/* Error State */}
      {fetchError && (
        <div className="rounded-xl border border-[var(--accent-red)]/20 bg-[var(--bg-elevated)] p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-[var(--accent-red)]/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-6 h-6 text-[var(--accent-red)]" />
          </div>
          <h3 className="text-sm font-medium mb-1">Failed to load sessions</h3>
          <p className="text-xs text-[var(--text-tertiary)] max-w-sm mx-auto mb-4">
            {fetchError}
          </p>
          <Button
            onClick={fetchSessions}
            variant="outline"
            size="sm"
            className="gap-1.5 border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </Button>
        </div>
      )}

      {/* Empty State -- no sessions at all */}
      {isEmptyState && <EmptySessionsState />}

      {/* No Results -- sessions exist but filter/search matches nothing */}
      {isNoResults && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-16 text-center">
          <div className="w-12 h-12 rounded-xl bg-[var(--bg-hover)] flex items-center justify-center mx-auto mb-4">
            <Search className="w-6 h-6 text-[var(--text-tertiary)]" />
          </div>
          <h3 className="text-sm font-medium mb-1">No matching sessions</h3>
          <p className="text-xs text-[var(--text-tertiary)]">
            Try adjusting your search or filter criteria.
          </p>
        </div>
      )}

      {/* Table */}
      {!loading && !fetchError && sessions.length > 0 && (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  {columns.map((col) => (
                    <th
                      key={col.label}
                      className={`text-left px-5 py-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium ${
                        col.sortKey ? "cursor-pointer select-none hover:text-[var(--text-secondary)] transition-colors" : ""
                      }`}
                      onClick={col.sortKey ? () => handleSort(col.sortKey!) : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {col.sortKey && sortBy === col.sortKey && (
                          sortDir === "asc" ? (
                            <ChevronUp className="w-3 h-3 text-[var(--accent-blue)]" />
                          ) : (
                            <ChevronDown className="w-3 h-3 text-[var(--accent-blue)]" />
                          )
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => {
                  const sc = statusConfig[session.status] || statusConfig.completed;
                  return (
                    <motion.tr
                      key={session.id}
                      variants={staggerItem}
                      onClick={() =>
                        router.push(`/dashboard/sessions/${session.id}`)
                      }
                      className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors cursor-pointer group"
                    >
                      <td className="px-5 py-3">
                        <span className="font-mono text-xs text-[var(--text-secondary)] group-hover:text-[var(--accent-blue)] transition-colors">
                          {session.id}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm">{session.agent_name}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium capitalize ${sc.bgClass}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${sc.dotClass}`}
                            style={{ backgroundColor: sc.color }}
                          />
                          {session.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-[var(--text-secondary)] tabular-nums">
                        {formatDuration(session.duration_ms)}
                      </td>
                      <td className="px-5 py-3 text-sm text-[var(--text-secondary)] tabular-nums">
                        {formatTokens(session.total_tokens)}
                      </td>
                      <td className="px-5 py-3 text-sm text-[var(--text-secondary)] tabular-nums">
                        {formatCost(session.total_cost_cents)}
                      </td>
                      <td className="px-5 py-3 text-xs text-[var(--text-tertiary)]">
                        {session.time_ago}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="flex flex-col sm:flex-row items-center justify-between px-5 py-3 border-t border-[var(--border-subtle)] gap-3">
            {/* Left: showing count + page size selector */}
            <div className="flex items-center gap-3">
              <p className="text-xs text-[var(--text-tertiary)]">
                Showing {(page - 1) * perPage + 1}
                {"\u2013"}
                {Math.min(page * perPage, meta.total)} of{" "}
                {meta.total} sessions
              </p>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[var(--text-tertiary)]">Per page:</span>
                <div className="flex gap-1">
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <button
                      key={size}
                      onClick={() => handlePerPageChange(size)}
                      className={`px-2 py-0.5 rounded text-xs transition-colors ${
                        perPage === size
                          ? "bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] border border-[var(--accent-blue)]/20"
                          : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: page navigation */}
            <div className="flex items-center gap-1">
              {/* First page */}
              <button
                onClick={() => handlePageChange(1)}
                disabled={page === 1}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="First page"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
              </button>

              {/* Previous */}
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-[var(--text-secondary)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-default)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-[var(--bg-elevated)] transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Prev
              </button>

              {/* Page numbers */}
              <div className="flex items-center gap-1">
                {pageNumbers.map((p, idx) =>
                  p === "ellipsis" ? (
                    <span
                      key={`ellipsis-${idx}`}
                      className="w-8 h-8 flex items-center justify-center text-xs text-[var(--text-tertiary)]"
                    >
                      ...
                    </span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => handlePageChange(p)}
                      className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                        page === p
                          ? "bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] border border-[var(--accent-blue)]/20"
                          : "hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}
              </div>

              {/* Next */}
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page === totalPages}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-[var(--text-secondary)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-default)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-[var(--bg-elevated)] transition-colors"
              >
                Next
                <ChevronRight className="w-3.5 h-3.5" />
              </button>

              {/* Last page */}
              <button
                onClick={() => handlePageChange(totalPages)}
                disabled={page === totalPages}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Last page"
              >
                <ChevronsRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Default export wraps in Suspense for useSearchParams compatibility
// ---------------------------------------------------------------------------

export default function SessionsPage() {
  return (
    <Suspense fallback={<SkeletonTable rows={6} cols={7} />}>
      <SessionsContent />
    </Suspense>
  );
}
