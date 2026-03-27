"use client";

import { useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { SkeletonBlock } from "@/components/skeleton";
import { SessionRow } from "@/components/sessions/session-row";
import type { Session } from "@/lib/types";

// ---------------------------------------------------------------------------
// Skeleton rows for loading state
// ---------------------------------------------------------------------------

function SkeletonRows({ count = 12 }: { count?: number }) {
  return (
    <div className="space-y-0">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-3 py-2 border-l-2 border-l-transparent"
        >
          <SkeletonBlock className="w-2 h-2 rounded-full flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <SkeletonBlock className="h-4 w-24 mb-1" />
            <SkeletonBlock className="h-3 w-14" />
          </div>
          <div className="text-right">
            <SkeletonBlock className="h-3 w-10 mb-1 ml-auto" />
            <SkeletonBlock className="h-3 w-12 ml-auto" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SessionListProps {
  sessions: Session[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  total: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionList({
  sessions,
  selectedSessionId,
  onSelectSession,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  total,
}: SessionListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !loadingMore && !loading) {
          onLoadMore();
        }
      },
      { threshold: 0.1, root: scrollContainerRef.current }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading, onLoadMore]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (sessions.length === 0) return;

      const currentIndex = sessions.findIndex(
        (s) => s.id === selectedSessionId
      );

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const nextIndex = Math.min(currentIndex + 1, sessions.length - 1);
        onSelectSession(sessions[nextIndex].id);
        // Scroll the selected row into view
        const container = scrollContainerRef.current;
        if (container) {
          const rows = container.querySelectorAll("[data-session-row]");
          rows[nextIndex]?.scrollIntoView({ block: "nearest" });
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prevIndex = Math.max(currentIndex - 1, 0);
        onSelectSession(sessions[prevIndex].id);
        const container = scrollContainerRef.current;
        if (container) {
          const rows = container.querySelectorAll("[data-session-row]");
          rows[prevIndex]?.scrollIntoView({ block: "nearest" });
        }
      }
    },
    [sessions, selectedSessionId, onSelectSession]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Initial loading state
  if (loading && sessions.length === 0) {
    return (
      <div className="flex-1 overflow-hidden">
        <SkeletonRows count={14} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Session count */}
      <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
        <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
          {total.toLocaleString()} session{total !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Scrollable list */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto"
      >
        {sessions.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-full min-h-[200px]">
            <p className="text-sm text-[var(--text-tertiary)]">
              No sessions found
            </p>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            {sessions.map((session) => (
              <div key={session.id} data-session-row>
                <SessionRow
                  session={session}
                  isSelected={session.id === selectedSessionId}
                  onClick={() => onSelectSession(session.id)}
                />
              </div>
            ))}

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="h-1" />

            {/* Loading more spinner */}
            {loadingMore && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 text-[var(--text-tertiary)] animate-spin" />
                <span className="text-xs text-[var(--text-tertiary)] ml-2">
                  Loading more...
                </span>
              </div>
            )}

            {/* End of list */}
            {!hasMore && sessions.length > 0 && (
              <div className="py-3 text-center">
                <p className="text-[10px] text-[var(--text-tertiary)]">
                  All sessions loaded
                </p>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
