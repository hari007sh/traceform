"use client";

import { useEffect } from "react";
import { Sidebar } from "@/components/sidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { OnboardingGuard } from "./onboarding-guard";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Force dark mode on all dashboard pages regardless of OS preference or
  // theme toggle.  The landing page can still honour user preference.
  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
  }, []);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <OnboardingGuard />
      <Sidebar />
      <main className="lg:pl-60 min-h-screen">
        <div className="max-w-7xl mx-auto p-6 lg:p-8">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
