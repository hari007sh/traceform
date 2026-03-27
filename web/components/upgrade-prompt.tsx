'use client';

import Link from 'next/link';
import { Lock, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface UpgradePromptProps {
  feature: string;
  requiredPlan?: string;
  currentPlan?: string;
  description?: string;
}

/**
 * UpgradePrompt is shown in place of gated features when the user's plan
 * does not include access.
 */
export function UpgradePrompt({
  feature,
  requiredPlan = 'Cloud',
  currentPlan = 'Free',
  description,
}: UpgradePromptProps) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-8 flex flex-col items-center text-center max-w-md mx-auto">
      <div className="w-12 h-12 rounded-xl bg-[var(--accent-purple)]/10 flex items-center justify-center mb-4">
        <Lock className="w-6 h-6 text-[var(--accent-purple)]" />
      </div>
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
        {feature}
      </h3>
      <p className="text-sm text-[var(--text-secondary)] mb-1">
        {description || `This feature requires the ${requiredPlan} plan or higher.`}
      </p>
      <p className="text-xs text-[var(--text-tertiary)] mb-6">
        You are currently on the <span className="font-medium text-[var(--text-secondary)]">{currentPlan}</span> plan.
      </p>
      <Link href="/dashboard/settings/billing">
        <Button variant="default" size="sm" className="gap-1.5">
          Upgrade to unlock
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Button>
      </Link>
    </div>
  );
}
