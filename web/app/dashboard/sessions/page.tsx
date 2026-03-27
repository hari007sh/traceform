"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  Suspense,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  Activity,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
  RefreshCw,
  Search,
} from "lucide-react";
import { fadeIn } from "@/lib/animations";
import { SkeletonTable } from "@/components/skeleton";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { useTimeRange } from "@/hooks/use-time-range";
import { SessionFilters } from "@/components/sessions/session-filters";
import { SessionList } from "@/components/sessions/session-list";
import { SessionDetailPanel } from "@/components/sessions/session-detail-panel";
import type { Session } from "@/lib/types";

// ---------------------------------------------------------------------------
// API response shape
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
// Copy button helper (reused from original)
// ---------------------------------------------------------------------------

function CopyButton({
  text,
  label = "Copy Setup Code",
  className = "",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
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
      {copied ? (
        <Check className="w-3.5 h-3.5" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
      {copied ? "Copied!" : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Empty state
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

        <div className="w-full rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)] overflow-hidden mb-5">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)]">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
              Python
            </span>
            <CopyButton text={SETUP_CODE} label="Copy" />
          </div>
          <pre className="px-4 py-3 text-[12px] leading-relaxed font-mono text-[var(--text-secondary)] text-left overflow-x-auto">
            <code>
              <span className="text-[var(--accent-purple)]">import</span>{" "}
              agentstack{"\n"}
              agentstack.
              <span className="text-[var(--accent-blue)]">init</span>(api_key=
              <span className="text-[var(--accent-green)]">
                &quot;your-key&quot;
              </span>
              , endpoint=
              <span className="text-[var(--accent-green)]">
                &quot;http://localhost:8080&quot;
              </span>
              ){"\n"}
              {"\n"}
              <span className="text-[var(--accent-purple)]">with</span>{" "}
              agentstack.
              <span className="text-[var(--accent-blue)]">session</span>
              (agent_name=
              <span className="text-[var(--accent-green)]">
                &quot;my-agent&quot;
              </span>
              ) <span className="text-[var(--accent-purple)]">as</span> session:
              {"\n"}
              {"    "}
              <span className="text-[var(--text-tertiary)]">
                # Your agent code here
              </span>
              {"\n"}
              {"    "}
              <span className="text-[var(--accent-purple)]">pass</span>
            </code>
          </pre>
        </div>

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
// Main Content Component
// ---------------------------------------------------------------------------

const PER_PAGE = 50;

function SessionsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { start, end } = useTimeRange();

  // ---------------------------------------------------------------------------
  // URL-driven filter state
  // ---------------------------------------------------------------------------
  const statusFilter = searchParams.get("status") || "all";
  const sortBy = searchParams.get("sort_by") || "started_at";
  const sortDir = searchParams.get("sort_dir") || "desc";
  const searchParam = searchParams.get("search") || "";
  const agentFilter = searchParams.get("agent_name") || "";

  // ---------------------------------------------------------------------------
  // Local state
  // ---------------------------------------------------------------------------
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [meta, setMeta] = useState<SessionsMeta>({
    page: 1,
    per_page: PER_PAGE,
    total: 0,
    total_pages: 1,
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );

  // Collected agent names for the agent filter dropdown
  const [agentNames, setAgentNames] = useState<string[]>([]);

  // Abort controller ref
  const abortRef = useRef<AbortController | null>(null);

  // ---------------------------------------------------------------------------
  // URL param update helper
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
      const qs = params.toString();
      router.replace(`/dashboard/sessions${qs ? `?${qs}` : ""}`, {
        scroll: false,
      });
    },
    [searchParams, router]
  );

  // ---------------------------------------------------------------------------
  // Build API URL
  // ---------------------------------------------------------------------------
  const buildApiUrl = useCallback(
    (page: number) => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("per_page", String(PER_PAGE));
      if (searchParam) params.set("search", searchParam);
      if (statusFilter && statusFilter !== "all")
        params.set("status", statusFilter);
      if (agentFilter) params.set("agent_name", agentFilter);
      if (sortBy) params.set("sort_by", sortBy);
      if (sortDir) params.set("sort_dir", sortDir);
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      return `/v1/sessions?${params.toString()}`;
    },
    [searchParam, statusFilter, agentFilter, sortBy, sortDir, start, end]
  );

  // ---------------------------------------------------------------------------
  // Fetch sessions (page 1 = reset, page > 1 = append)
  // ---------------------------------------------------------------------------
  const fetchSessions = useCallback(
    async (page: number, append: boolean = false) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setFetchError(null);
      }

      try {
        const token =
          typeof window !== "undefined"
            ? localStorage.getItem("token")
            : null;
        if (token) {
          api.setToken(token);
        }

        const url = buildApiUrl(page);
        const data = await api.get<SessionsAPIResponse>(url);

        if (controller.signal.aborted) return;

        const newSessions = data.sessions ?? [];
        const newMeta = data.meta || {
          page: page,
          per_page: PER_PAGE,
          total: data.total || 0,
          total_pages: Math.max(1, Math.ceil((data.total || 0) / PER_PAGE)),
        };

        if (append) {
          setSessions((prev) => [...prev, ...newSessions]);
        } else {
          setSessions(newSessions);
          // Collect unique agent names from the first page for the filter dropdown
          const names = new Set<string>();
          newSessions.forEach((s) => {
            if (s.agent_name) names.add(s.agent_name);
          });
          setAgentNames((prev) => {
            const combined = new Set([...prev, ...Array.from(names)]);
            return Array.from(combined).sort();
          });
        }

        setMeta(newMeta);
        setCurrentPage(page);
      } catch (err) {
        if (controller.signal.aborted) return;

        const message =
          err instanceof ApiError
            ? `${err.message} (${err.code})`
            : err instanceof Error
              ? err.message
              : "Failed to load sessions";

        console.error(
          "[AgentStack] SessionsPage: API fetch failed:",
          message
        );
        if (!append) {
          setFetchError(message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [buildApiUrl]
  );

  // ---------------------------------------------------------------------------
  // Initial fetch + refetch on filter changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    setCurrentPage(1);
    fetchSessions(1, false);
    return () => {
      abortRef.current?.abort();
    };
  }, [fetchSessions]);

  // ---------------------------------------------------------------------------
  // Infinite scroll: load more
  // ---------------------------------------------------------------------------
  const hasMore = currentPage < meta.total_pages;
  const handleLoadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      fetchSessions(currentPage + 1, true);
    }
  }, [currentPage, hasMore, loadingMore, fetchSessions]);

  // ---------------------------------------------------------------------------
  // Filter change handlers
  // ---------------------------------------------------------------------------
  const handleSearchChange = useCallback(
    (search: string) => {
      updateParams({ search: search || null });
    },
    [updateParams]
  );

  const handleStatusChange = useCallback(
    (status: string) => {
      updateParams({ status: status === "all" ? null : status });
    },
    [updateParams]
  );

  const handleSortChange = useCallback(
    (newSortBy: string, newSortDir: string) => {
      updateParams({ sort_by: newSortBy, sort_dir: newSortDir });
    },
    [updateParams]
  );

  const handleAgentChange = useCallback(
    (agent: string) => {
      updateParams({ agent_name: agent || null });
    },
    [updateParams]
  );

  // ---------------------------------------------------------------------------
  // Responsive: on small screens, clicking navigates to detail page
  // ---------------------------------------------------------------------------
  const handleSelectSession = useCallback(
    (id: string) => {
      // On small screens, navigate to the standalone detail page
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        router.push(`/dashboard/sessions/${id}`);
        return;
      }
      setSelectedSessionId(id);
    },
    [router]
  );

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------
  const isEmptyState =
    !loading &&
    !fetchError &&
    meta.total === 0 &&
    !searchParam &&
    statusFilter === "all" &&
    !agentFilter;

  return (
    <motion.div
      variants={fadeIn}
      initial="hidden"
      animate="visible"
      className="flex flex-col h-[calc(100vh-64px)]"
    >
      {/* Filters */}
      <div className="px-6 pt-6 pb-4 flex-shrink-0">
        <SessionFilters
          searchParam={searchParam}
          statusFilter={statusFilter}
          sortBy={sortBy}
          sortDir={sortDir}
          agentNames={agentNames}
          agentFilter={agentFilter}
          onSearchChange={handleSearchChange}
          onStatusChange={handleStatusChange}
          onSortChange={handleSortChange}
          onAgentChange={handleAgentChange}
          disabled={isEmptyState}
        />
      </div>

      {/* Error State */}
      {fetchError && (
        <div className="px-6 pb-4">
          <div className="rounded-xl border border-[var(--accent-red)]/20 bg-[var(--bg-elevated)] p-8 text-center">
            <div className="w-12 h-12 rounded-xl bg-[var(--accent-red)]/10 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6 text-[var(--accent-red)]" />
            </div>
            <h3 className="text-sm font-medium mb-1">
              Failed to load sessions
            </h3>
            <p className="text-xs text-[var(--text-tertiary)] max-w-sm mx-auto mb-4">
              {fetchError}
            </p>
            <Button
              onClick={() => fetchSessions(1, false)}
              variant="outline"
              size="sm"
              className="gap-1.5 border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </Button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {isEmptyState && (
        <div className="px-6 pb-4">
          <EmptySessionsState />
        </div>
      )}

      {/* No Results (sessions exist but filter matches nothing) */}
      {!loading &&
        !fetchError &&
        sessions.length === 0 &&
        !isEmptyState && (
          <div className="px-6 pb-4">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-16 text-center">
              <div className="w-12 h-12 rounded-xl bg-[var(--bg-hover)] flex items-center justify-center mx-auto mb-4">
                <Search className="w-6 h-6 text-[var(--text-tertiary)]" />
              </div>
              <h3 className="text-sm font-medium mb-1">
                No matching sessions
              </h3>
              <p className="text-xs text-[var(--text-tertiary)]">
                Try adjusting your search or filter criteria.
              </p>
            </div>
          </div>
        )}

      {/* Split-pane layout */}
      {!fetchError && !isEmptyState && (loading || sessions.length > 0) && (
        <div className="flex-1 flex overflow-hidden mx-6 mb-6 rounded-xl border border-[var(--border-subtle)]">
          {/* Left panel: Session List (30% width on desktop) */}
          <div className="w-full lg:w-[30%] lg:min-w-[280px] lg:max-w-[400px] bg-[var(--bg-secondary)] border-r border-[var(--border-subtle)] flex flex-col overflow-hidden">
            <SessionList
              sessions={sessions}
              selectedSessionId={selectedSessionId}
              onSelectSession={handleSelectSession}
              loading={loading}
              loadingMore={loadingMore}
              hasMore={hasMore}
              onLoadMore={handleLoadMore}
              total={meta.total}
            />
          </div>

          {/* Right panel: Session Detail (70% width on desktop, hidden on mobile) */}
          <div className="hidden lg:flex flex-1 bg-[var(--bg-primary)] overflow-hidden">
            <div className="flex-1 overflow-y-auto">
              <SessionDetailPanel sessionId={selectedSessionId} />
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Default export wrapped in Suspense
// ---------------------------------------------------------------------------

export default function SessionsPage() {
  return (
    <Suspense fallback={<SkeletonTable rows={6} cols={7} />}>
      <SessionsContent />
    </Suspense>
  );
}
