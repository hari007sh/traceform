"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Search, ChevronDown, ArrowUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TimeRangePicker } from "@/components/time-range-picker";

// ---------------------------------------------------------------------------
// Status configuration
// ---------------------------------------------------------------------------

const statusConfig: Record<
  string,
  { color: string; bgClass: string }
> = {
  completed: {
    color: "var(--accent-green)",
    bgClass:
      "bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20",
  },
  failed: {
    color: "var(--accent-red)",
    bgClass:
      "bg-[var(--accent-red)]/10 text-[var(--accent-red)] border border-[var(--accent-red)]/20",
  },
  running: {
    color: "var(--accent-blue)",
    bgClass:
      "bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] border border-[var(--accent-blue)]/20",
  },
  timeout: {
    color: "var(--accent-amber)",
    bgClass:
      "bg-[var(--accent-amber)]/10 text-[var(--accent-amber)] border border-[var(--accent-amber)]/20",
  },
  healed: {
    color: "var(--healing-blue)",
    bgClass:
      "bg-[var(--healing-blue)]/10 text-[var(--healing-blue)] border border-[var(--healing-blue)]/20",
  },
};

const STATUSES = ["all", "completed", "failed", "running", "timeout", "healed"] as const;

type SortOption = {
  label: string;
  sortBy: string;
  sortDir: "asc" | "desc";
};

const SORT_OPTIONS: SortOption[] = [
  { label: "Newest first", sortBy: "started_at", sortDir: "desc" },
  { label: "Oldest first", sortBy: "started_at", sortDir: "asc" },
  { label: "Longest duration", sortBy: "duration_ms", sortDir: "desc" },
  { label: "Shortest duration", sortBy: "duration_ms", sortDir: "asc" },
  { label: "Highest cost", sortBy: "total_cost_cents", sortDir: "desc" },
  { label: "Lowest cost", sortBy: "total_cost_cents", sortDir: "asc" },
];

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
// Props
// ---------------------------------------------------------------------------

interface SessionFiltersProps {
  searchParam: string;
  statusFilter: string;
  sortBy: string;
  sortDir: string;
  agentNames: string[];
  agentFilter: string;
  onSearchChange: (search: string) => void;
  onStatusChange: (status: string) => void;
  onSortChange: (sortBy: string, sortDir: string) => void;
  onAgentChange: (agent: string) => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionFilters({
  searchParam,
  statusFilter,
  sortBy,
  sortDir,
  agentNames,
  agentFilter,
  onSearchChange,
  onStatusChange,
  onSortChange,
  onAgentChange,
  disabled = false,
}: SessionFiltersProps) {
  const [searchInput, setSearchInput] = useState(searchParam);
  const debouncedSearch = useDebounce(searchInput, 300);

  // Sync debounced value back to parent
  useEffect(() => {
    if (debouncedSearch !== searchParam) {
      onSearchChange(debouncedSearch);
    }
  }, [debouncedSearch, searchParam, onSearchChange]);

  // Sync external changes to local input
  useEffect(() => {
    setSearchInput(searchParam);
  }, [searchParam]);

  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [showAgentDropdown, setShowAgentDropdown] = useState(false);

  const currentSort = useMemo(
    () =>
      SORT_OPTIONS.find(
        (o) => o.sortBy === sortBy && o.sortDir === sortDir
      ) ?? SORT_OPTIONS[0],
    [sortBy, sortDir]
  );

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClick = () => {
      setShowSortDropdown(false);
      setShowAgentDropdown(false);
    };
    if (showSortDropdown || showAgentDropdown) {
      document.addEventListener("click", handleClick);
      return () => document.removeEventListener("click", handleClick);
    }
  }, [showSortDropdown, showAgentDropdown]);

  return (
    <div className={`space-y-3 ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      {/* Top row: Title + Time Range */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Sessions</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">
            Browse and inspect agent execution sessions
          </p>
        </div>
        <TimeRangePicker />
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
        <Input
          placeholder="Search by agent name or session ID..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="pl-10 bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-sm h-9"
          disabled={disabled}
        />
      </div>

      {/* Filter row: Status chips + Agent dropdown + Sort dropdown */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Status chips */}
        {STATUSES.map((status) => {
          const isActive = statusFilter === status;
          const config = status !== "all" ? statusConfig[status] : null;
          return (
            <button
              key={status}
              onClick={() => onStatusChange(status)}
              disabled={disabled}
              className={`px-2.5 py-1 text-[11px] rounded-md border transition-all duration-150 capitalize ${
                isActive
                  ? status === "all"
                    ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]"
                    : config?.bgClass || ""
                  : "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              {status !== "all" && (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle"
                  style={{ backgroundColor: config?.color }}
                />
              )}
              {status}
            </button>
          );
        })}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Agent dropdown */}
        {agentNames.length > 0 && (
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowAgentDropdown(!showAgentDropdown);
                setShowSortDropdown(false);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              {agentFilter ? agentFilter : "All agents"}
              <ChevronDown className="w-3 h-3" />
            </button>
            {showAgentDropdown && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-lg py-1">
                <button
                  onClick={() => {
                    onAgentChange("");
                    setShowAgentDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
                    !agentFilter
                      ? "text-[var(--accent-blue)] bg-[var(--accent-blue)]/5"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  All agents
                </button>
                {agentNames.map((name) => (
                  <button
                    key={name}
                    onClick={() => {
                      onAgentChange(name);
                      setShowAgentDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors truncate ${
                      agentFilter === name
                        ? "text-[var(--accent-blue)] bg-[var(--accent-blue)]/5"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Sort dropdown */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowSortDropdown(!showSortDropdown);
              setShowAgentDropdown(false);
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <ArrowUpDown className="w-3 h-3" />
            {currentSort.label}
            <ChevronDown className="w-3 h-3" />
          </button>
          {showSortDropdown && (
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-lg py-1">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={`${option.sortBy}-${option.sortDir}`}
                  onClick={() => {
                    onSortChange(option.sortBy, option.sortDir);
                    setShowSortDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
                    sortBy === option.sortBy && sortDir === option.sortDir
                      ? "text-[var(--accent-blue)] bg-[var(--accent-blue)]/5"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
