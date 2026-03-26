"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  Filter,
  RefreshCw,
} from "lucide-react";
import { fadeIn, staggerContainer, staggerItem } from "@/lib/animations";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { showError, showApiError } from "@/lib/toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AuditEntry {
  id: string;
  timestamp: string;
  user_id: string;
  user_email: string;
  action: string;
  resource_type: string;
  resource_id: string;
  ip_address: string;
  details: Record<string, unknown>;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
function formatTimestamp(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

const ACTION_OPTIONS = [
  { value: "all", label: "All Actions" },
  { value: "create", label: "Create" },
  { value: "update", label: "Update" },
  { value: "delete", label: "Delete" },
  { value: "login", label: "Login" },
  { value: "logout", label: "Logout" },
  { value: "invite", label: "Invite" },
  { value: "role_change", label: "Role Change" },
  { value: "sso_config", label: "SSO Config" },
  { value: "api_key", label: "API Key" },
];

const actionColors: Record<string, string> = {
  create: "text-[var(--accent-green)] bg-[var(--accent-green)]/10",
  update: "text-[var(--accent-blue)] bg-[var(--accent-blue)]/10",
  delete: "text-[var(--accent-red)] bg-[var(--accent-red)]/10",
  login: "text-[var(--accent-purple)] bg-[var(--accent-purple)]/10",
  logout: "text-[var(--text-tertiary)] bg-[var(--bg-hover)]",
  invite: "text-[var(--accent-amber)] bg-[var(--accent-amber)]/10",
  role_change: "text-[var(--accent-purple)] bg-[var(--accent-purple)]/10",
  sso_config: "text-[var(--accent-blue)] bg-[var(--accent-blue)]/10",
  api_key: "text-[var(--accent-amber)] bg-[var(--accent-amber)]/10",
};

// ---------------------------------------------------------------------------
// Inner component that uses useSearchParams (needs Suspense boundary)
// ---------------------------------------------------------------------------
function AuditLogContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const page = parseInt(searchParams.get("page") || "1", 10);
  const perPage = 50;

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [actionFilter, setActionFilter] = useState("all");
  const [emailSearch, setEmailSearch] = useState("");

  const initToken = useCallback(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (token) {
      api.setToken(token);
    }
    return !!token;
  }, []);

  const fetchAuditLogs = useCallback(
    async (isRefresh = false) => {
      if (!initToken()) {
        setLoading(false);
        return;
      }

      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("per_page", String(perPage));
        if (actionFilter !== "all") params.set("action", actionFilter);
        if (emailSearch.trim()) params.set("email", emailSearch.trim());

        const data = await api.get<AuditResponse>(`/api/audit-logs?${params.toString()}`);
        setEntries(data.entries || []);
        setTotal(data.total || 0);
        setTotalPages(data.total_pages || 1);
      } catch (err) {
        if (err instanceof ApiError) {
          showApiError(err);
        } else {
          showError("Failed to load audit logs");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [initToken, page, perPage, actionFilter, emailSearch]
  );

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  const goToPage = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(newPage));
    router.push(`/dashboard/settings/audit?${params.toString()}`);
  };

  const handleFilterApply = () => {
    const params = new URLSearchParams();
    params.set("page", "1");
    router.push(`/dashboard/settings/audit?${params.toString()}`);
  };

  // Skeleton loading state
  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <div className="h-6 w-40 bg-[var(--bg-hover)] rounded animate-pulse" />
          <div className="h-4 w-72 bg-[var(--bg-hover)] rounded animate-pulse mt-2" />
        </div>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6">
          <div className="space-y-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <div className="h-5 w-32 bg-[var(--bg-hover)] rounded animate-pulse" />
                <div className="h-5 w-40 bg-[var(--bg-hover)] rounded animate-pulse" />
                <div className="h-5 w-20 bg-[var(--bg-hover)] rounded animate-pulse" />
                <div className="h-5 flex-1 bg-[var(--bg-hover)] rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
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
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Audit Log</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Track all actions and changes across your organization
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchAuditLogs(true)}
          disabled={refreshing}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <motion.div
        variants={staggerItem}
        className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
            <Filter className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wider font-medium">Filters</span>
          </div>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-[180px] bg-[var(--bg-primary)] border-[var(--border-default)] h-9 text-sm">
              <SelectValue placeholder="All Actions" />
            </SelectTrigger>
            <SelectContent>
              {ACTION_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            <Input
              value={emailSearch}
              onChange={(e) => setEmailSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleFilterApply(); }}
              placeholder="Search by email..."
              className="pl-9 h-9 bg-[var(--bg-primary)] border-[var(--border-default)] text-sm"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleFilterApply}
          >
            Apply
          </Button>
        </div>
      </motion.div>

      {/* Table */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden"
      >
        {/* Table header */}
        <div className="grid grid-cols-[160px_180px_120px_120px_120px_120px] gap-2 px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">Time</span>
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">User</span>
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">Action</span>
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">Resource Type</span>
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">Resource ID</span>
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">IP Address</span>
        </div>

        {/* Empty state */}
        {entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-12 h-12 rounded-xl bg-[var(--bg-hover)] flex items-center justify-center mb-4">
              <FileText className="w-6 h-6 text-[var(--text-tertiary)]" />
            </div>
            <p className="text-sm font-medium text-[var(--text-primary)]">No audit log entries</p>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              Actions will appear here once team members start using the platform
            </p>
          </div>
        )}

        {/* Rows */}
        {entries.map((entry) => (
          <motion.div key={entry.id} variants={staggerItem}>
            <button
              onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              className="w-full grid grid-cols-[160px_180px_120px_120px_120px_120px] gap-2 px-4 py-2.5 hover:bg-[var(--bg-hover)] transition-colors text-left items-center"
            >
              <span className="text-xs text-[var(--text-secondary)] font-mono truncate">
                {formatTimestamp(entry.timestamp)}
              </span>
              <span className="text-xs text-[var(--text-primary)] truncate">
                {entry.user_email || entry.user_id}
              </span>
              <span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${actionColors[entry.action] || "text-[var(--text-secondary)] bg-[var(--bg-hover)]"}`}>
                  {entry.action}
                </span>
              </span>
              <span className="text-xs text-[var(--text-secondary)] truncate">
                {entry.resource_type}
              </span>
              <span className="text-xs text-[var(--text-tertiary)] font-mono truncate">
                {entry.resource_id ? entry.resource_id.substring(0, 8) + "..." : "-"}
              </span>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-tertiary)] font-mono truncate">
                  {entry.ip_address || "-"}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-[var(--text-tertiary)] transition-transform duration-200 ${
                    expandedId === entry.id ? "rotate-180" : ""
                  }`}
                />
              </div>
            </button>

            {/* Expanded details */}
            <AnimatePresence>
              {expandedId === entry.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 py-3 bg-[var(--bg-primary)] border-t border-[var(--border-subtle)]">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-2">
                      Full Details
                    </p>
                    <pre className="text-xs font-mono text-[var(--text-secondary)] bg-[var(--bg-secondary)] rounded-lg p-3 overflow-x-auto border border-[var(--border-subtle)]">
                      {JSON.stringify(entry.details || entry, null, 2)}
                    </pre>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </motion.div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-[var(--text-tertiary)]">
            Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total} entries
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(1)}
              disabled={page <= 1}
              className="h-8 w-8 p-0"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              className="h-8 w-8 p-0"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <span className="px-3 text-xs text-[var(--text-secondary)]">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className="h-8 w-8 p-0"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(totalPages)}
              disabled={page >= totalPages}
              className="h-8 w-8 p-0"
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Page wrapper with Suspense boundary (required for useSearchParams)
// ---------------------------------------------------------------------------
export default function AuditLogPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div>
            <div className="h-6 w-40 bg-[var(--bg-hover)] rounded animate-pulse" />
            <div className="h-4 w-72 bg-[var(--bg-hover)] rounded animate-pulse mt-2" />
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6">
            <div className="space-y-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <div className="h-5 w-32 bg-[var(--bg-hover)] rounded animate-pulse" />
                  <div className="h-5 w-40 bg-[var(--bg-hover)] rounded animate-pulse" />
                  <div className="h-5 w-20 bg-[var(--bg-hover)] rounded animate-pulse" />
                  <div className="h-5 flex-1 bg-[var(--bg-hover)] rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        </div>
      }
    >
      <AuditLogContent />
    </Suspense>
  );
}
