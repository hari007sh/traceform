import { Sidebar } from "@/components/sidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { OnboardingGuard } from "./onboarding-guard";

export const dynamic = 'force-dynamic';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {

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
