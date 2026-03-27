"use client";

import { memo } from "react";
import type { Session } from "@/lib/types";

// ---------------------------------------------------------------------------
// Status dot color mapping
// ---------------------------------------------------------------------------

const statusDotColor: Record<string, string> = {
  completed: "bg-[var(--accent-green)]",
  failed: "bg-[var(--accent-red)]",
  running: "bg-[var(--accent-blue)] animate-pulse",
  timeout: "bg-[var(--accent-amber)]",
  healed: "bg-[var(--healing-blue)] status-healed",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms === 0) return "\u2014";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTimeAgo(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatCost(cents: number): string {
  if (cents === 0) return "";
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SessionRowProps {
  session: Session;
  isSelected: boolean;
  onClick: () => void;
}

// ---------------------------------------------------------------------------
// Component — memoized for virtual scroll performance
// ---------------------------------------------------------------------------

export const SessionRow = memo(function SessionRow({
  session,
  isSelected,
  onClick,
}: SessionRowProps) {
  const dotClass = statusDotColor[session.status] ?? statusDotColor.completed;
  const cost = formatCost(session.total_cost_cents);

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2 cursor-pointer border-l-2 transition-all duration-150 ${
        isSelected
          ? "border-l-[var(--accent-blue)] bg-[var(--accent-blue)]/5"
          : "border-l-transparent hover:bg-[var(--bg-hover)]"
      }`}
    >
      {/* Status dot */}
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`} />

      {/* Agent name + ID */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate text-[var(--text-primary)]">
          {session.agent_name}
        </p>
        <p className="text-[10px] text-[var(--text-tertiary)] font-mono">
          {session.id.slice(0, 8)}
        </p>
      </div>

      {/* Duration + Time ago + Cost */}
      <div className="text-right shrink-0">
        <p className="text-xs font-mono text-[var(--text-secondary)]">
          {formatDuration(session.duration_ms)}
        </p>
        <div className="flex items-center gap-1.5 justify-end">
          {cost && (
            <span className="text-[10px] text-[var(--text-tertiary)]">
              {cost}
            </span>
          )}
          <span className="text-[10px] text-[var(--text-tertiary)]">
            {formatTimeAgo(session.started_at)}
          </span>
        </div>
      </div>
    </div>
  );
});
