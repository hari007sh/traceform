import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col items-center justify-center text-center gap-4">
      <h1 className="text-6xl font-bold text-[var(--text-primary)]">404</h1>
      <p className="text-lg text-[var(--text-secondary)]">Page not found</p>
      <Link
        href="/dashboard/overview"
        className="px-4 py-2 rounded-lg bg-[var(--accent-blue)] text-white text-sm font-medium hover:bg-[var(--accent-blue)]/90 transition-colors"
      >
        Go to Dashboard
      </Link>
    </div>
  );
}
