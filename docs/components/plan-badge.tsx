import React from 'react';

const planColors: Record<string, { bg: string; text: string; border: string }> = {
  free: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  cloud: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  team: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20' },
  enterprise: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
};

export function PlanBadge({ plan }: { plan: 'free' | 'cloud' | 'team' | 'enterprise' }) {
  const colors = planColors[plan] || planColors.free;
  const label = plan.charAt(0).toUpperCase() + plan.slice(1);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${colors.bg} ${colors.text} ${colors.border} ml-2`}>
      {label}
    </span>
  );
}

export function UpgradeCallout({ plan, feature }: { plan: string; feature: string }) {
  return (
    <div className="my-4 p-4 rounded-lg border border-amber-500/20 bg-amber-500/5">
      <p className="text-sm text-amber-200">
        <strong>{feature}</strong> requires the <strong>{plan}</strong> plan.{' '}
        <a href="/docs/enterprise" className="underline">Learn more about plans &rarr;</a>
      </p>
    </div>
  );
}
