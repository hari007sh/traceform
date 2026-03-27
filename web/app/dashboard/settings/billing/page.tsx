"use client";

import { motion } from "framer-motion";
import {
  CreditCard,
  Zap,
  ArrowUpRight,
  Check,
  Mail,
  BarChart3,
  Users,
  Webhook,
  X,
} from "lucide-react";
import { fadeIn, staggerContainer, staggerItem } from "@/lib/animations";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { showSuccess } from "@/lib/toast";
import { usePlan } from "@/hooks/use-plan";

// --- Plan tier types ---
type PlanTier = "free" | "cloud" | "team" | "enterprise";

interface PlanCard {
  name: string;
  price: string;
  period: string;
  features: string[];
  limits: {
    events: string;
    retention: string;
    members: string;
    webhooks: string;
  };
  gatedFeatures: {
    sso: boolean;
    auditLog: boolean;
    dataExport: boolean;
    customRoles: boolean;
  };
  highlight?: boolean;
  cta: string;
  stripeUrl?: string;
}

const allPlans: Record<PlanTier, PlanCard> = {
  free: {
    name: "Self-Hosted",
    price: "Free",
    period: "forever",
    features: [
      "All 6 modules",
      "Open-source codebase",
      "Community support",
      "Self-managed infrastructure",
    ],
    limits: { events: "10K/mo", retention: "7 days", members: "3", webhooks: "2" },
    gatedFeatures: { sso: false, auditLog: false, dataExport: false, customRoles: false },
    cta: "Current",
  },
  cloud: {
    name: "Cloud",
    price: "$49",
    period: "/month",
    features: [
      "All 6 modules",
      "Managed hosting",
      "Email support",
      "Automatic updates",
      "Audit logs",
      "Data export",
      "99.9% uptime SLA",
    ],
    limits: { events: "100K/mo", retention: "30 days", members: "5", webhooks: "10" },
    gatedFeatures: { sso: false, auditLog: true, dataExport: true, customRoles: false },
    cta: "Upgrade",
    stripeUrl: "https://billing.stripe.com/p/login/agentstack-cloud",
  },
  team: {
    name: "Team",
    price: "$199",
    period: "/month",
    features: [
      "All 6 modules",
      "Managed hosting",
      "Priority support",
      "Advanced analytics",
      "Team collaboration",
      "Audit logs",
      "Data export",
      "99.95% uptime SLA",
    ],
    limits: { events: "1M/mo", retention: "90 days", members: "25", webhooks: "100" },
    gatedFeatures: { sso: false, auditLog: true, dataExport: true, customRoles: false },
    highlight: true,
    cta: "Upgrade",
    stripeUrl: "https://billing.stripe.com/p/login/agentstack-team",
  },
  enterprise: {
    name: "Enterprise",
    price: "Custom",
    period: "",
    features: [
      "All 6 modules",
      "On-premise deploy",
      "Dedicated SLA",
      "SSO / SAML",
      "Custom roles",
      "Audit logs",
      "Data export",
      "Data residency",
      "Dedicated support",
    ],
    limits: { events: "Unlimited", retention: "365 days", members: "Unlimited", webhooks: "Unlimited" },
    gatedFeatures: { sso: true, auditLog: true, dataExport: true, customRoles: true },
    cta: "Contact Sales",
  },
};

const planColors: Record<string, string> = {
  free: "bg-zinc-500/10 text-zinc-400",
  cloud: "bg-blue-500/10 text-blue-400",
  team: "bg-purple-500/10 text-purple-400",
  enterprise: "bg-amber-500/10 text-amber-400",
};

const planDisplayNames: Record<string, string> = {
  free: "Self-Hosted",
  cloud: "Cloud",
  team: "Team",
  enterprise: "Enterprise",
};

function handlePlanAction(tier: PlanTier) {
  const plan = allPlans[tier];
  if (tier === "enterprise") {
    window.location.href = "mailto:sales@agentstack.dev?subject=AgentStack%20Enterprise%20Inquiry";
    return;
  }
  if (plan.stripeUrl) {
    window.open(plan.stripeUrl, "_blank");
    return;
  }
  showSuccess("Contact sales@agentstack.dev to change plans");
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function UsageBar({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const isUnlimited = max < 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-[var(--text-secondary)]">{label}</span>
        <span className="text-xs font-medium text-[var(--text-primary)] tabular-nums">
          {formatNumber(value)} / {isUnlimited ? "Unlimited" : formatNumber(max)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: isUnlimited ? "5%" : `${Math.max(1, percent)}%` }}
        />
      </div>
      {!isUnlimited && percent >= 80 && (
        <p className="text-[10px] text-[var(--accent-amber)] mt-1">
          {percent >= 100 ? "Limit reached" : "Approaching limit"}
        </p>
      )}
    </div>
  );
}

function FeatureRow({ name, enabled }: { name: string; enabled: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {enabled ? (
        <Check className="w-3.5 h-3.5 text-[var(--accent-green)] flex-shrink-0" />
      ) : (
        <X className="w-3.5 h-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
      )}
      <span className={enabled ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]"}>
        {name}
      </span>
    </div>
  );
}

export default function BillingPage() {
  const { plan: planInfo, loading } = usePlan();
  const currentTier = (planInfo?.plan || "free") as PlanTier;
  const currentPlanDisplay = planDisplayNames[currentTier] || "Self-Hosted";
  const currentPlanData = allPlans[currentTier] || allPlans.free;

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-6 w-32 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
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
      <div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Billing</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Manage your subscription plan and monitor usage
        </p>
      </div>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-6"
      >
        {/* Current plan card */}
        <motion.div
          variants={staggerItem}
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
        >
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[var(--accent-purple)]/10 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-[var(--accent-purple)]" />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-semibold text-[var(--text-primary)]">Current Plan</h2>
                  <Badge
                    className={`${planColors[currentTier]} border-0 text-[10px] uppercase tracking-wider font-semibold`}
                  >
                    {currentPlanDisplay}
                  </Badge>
                </div>
                <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                  {currentTier === "free"
                    ? "Open-source self-hosted deployment"
                    : `Managed ${currentPlanDisplay} subscription`}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-[var(--text-primary)] tabular-nums">
                {currentPlanData.price}
              </p>
              <p className="text-xs text-[var(--text-tertiary)]">{currentPlanData.period || "forever"}</p>
            </div>
          </div>

          {/* Plan features quick list */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-5">
            <FeatureRow name="SSO / SAML" enabled={planInfo?.features.sso ?? false} />
            <FeatureRow name="Audit Logs" enabled={planInfo?.features.auditLog ?? false} />
            <FeatureRow name="Data Export" enabled={planInfo?.features.dataExport ?? false} />
            <FeatureRow name="Custom Roles" enabled={planInfo?.features.customRoles ?? false} />
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-4 p-4 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)]">
            <div>
              <p className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                Events
              </p>
              <p className="text-lg font-semibold mt-1 text-[var(--text-primary)]">
                {currentPlanData.limits.events}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                Data Retention
              </p>
              <p className="text-lg font-semibold mt-1 text-[var(--text-primary)]">
                {currentPlanData.limits.retention}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                Team Members
              </p>
              <p className="text-lg font-semibold mt-1 text-[var(--text-primary)]">
                {currentPlanData.limits.members}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Usage Meters */}
        <motion.div
          variants={staggerItem}
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
        >
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-lg bg-[var(--accent-blue)]/10 flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-[var(--accent-blue)]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Usage This Month</h2>
              <p className="text-xs text-[var(--text-tertiary)]">
                Current billing period usage
              </p>
            </div>
          </div>

          <div className="space-y-5">
            <UsageBar
              value={planInfo?.eventsThisMonth ?? 0}
              max={planInfo?.eventsLimit ?? 10000}
              label="Events"
              color={
                (planInfo?.usagePercent ?? 0) >= 90
                  ? "bg-[var(--accent-red)]"
                  : (planInfo?.usagePercent ?? 0) >= 70
                  ? "bg-[var(--accent-amber)]"
                  : "bg-[var(--accent-blue)]"
              }
            />

            <UsageBar
              value={planInfo?.teamMembers ?? 0}
              max={planInfo?.teamLimit ?? 3}
              label="Team Members"
              color="bg-[var(--accent-purple)]"
            />

            <UsageBar
              value={planInfo?.webhooks ?? 0}
              max={planInfo?.webhooksLimit ?? 2}
              label="Webhooks"
              color="bg-[var(--accent-green)]"
            />
          </div>
        </motion.div>

        {/* Payment & Invoices */}
        <motion.div
          variants={staggerItem}
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-[var(--bg-hover)] flex items-center justify-center">
              <CreditCard className="w-4 h-4 text-[var(--text-tertiary)]" />
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Payment Method</h2>
              <p className="text-xs text-[var(--text-tertiary)]">
                {currentTier === "free"
                  ? "No payment required for self-hosted"
                  : "Manage your payment method"}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-7 rounded bg-[var(--bg-hover)] flex items-center justify-center">
                <CreditCard className="w-4 h-4 text-[var(--text-tertiary)]" />
              </div>
              <div>
                <p className="text-sm text-[var(--text-secondary)]">No payment method on file</p>
                <p className="text-xs text-[var(--text-tertiary)]">
                  {currentTier === "free"
                    ? "Add a payment method to upgrade"
                    : "Update your card details"}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                showSuccess("Stripe billing portal coming soon")
              }
            >
              {currentTier === "free" ? "Add Card" : "Update"}
            </Button>
          </div>

          {/* Billing Contact */}
          <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-[var(--text-tertiary)]" />
                <div>
                  <p className="text-sm text-[var(--text-primary)]">Invoices</p>
                  <p className="text-xs text-[var(--text-tertiary)]">
                    {currentTier === "free" ? "No invoices for self-hosted" : "View and download invoices"}
                  </p>
                </div>
              </div>
              {currentTier !== "free" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => showSuccess("Invoice history coming soon")}
                >
                  View Invoices
                </Button>
              )}
            </div>
          </div>
        </motion.div>

        {/* Plan Comparison */}
        <motion.div
          variants={staggerItem}
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-lg bg-[var(--accent-green)]/10 flex items-center justify-center">
              <Zap className="w-4 h-4 text-[var(--accent-green)]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Compare Plans</h2>
              <p className="text-xs text-[var(--text-tertiary)]">
                Find the right plan for your team
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {(Object.entries(allPlans) as [PlanTier, PlanCard][]).map(([tier, plan]) => {
              const isCurrent = tier === currentTier;
              const isDowngrade =
                ["free", "cloud", "team", "enterprise"].indexOf(tier) <
                ["free", "cloud", "team", "enterprise"].indexOf(currentTier);

              return (
                <div
                  key={tier}
                  className={`rounded-xl border p-5 flex flex-col ${
                    isCurrent
                      ? "border-[var(--accent-blue)]/30 bg-[var(--accent-blue)]/[0.03]"
                      : plan.highlight
                      ? "border-[var(--accent-purple)]/20 bg-[var(--accent-purple)]/[0.02]"
                      : "border-[var(--border-subtle)] bg-[var(--bg-primary)]"
                  }`}
                >
                  {isCurrent && (
                    <Badge className="w-fit mb-2 bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] border-0 text-[10px] uppercase tracking-wider font-semibold">
                      Current
                    </Badge>
                  )}
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{plan.name}</h3>
                  <div className="mt-2 mb-4">
                    <span className="text-2xl font-bold text-[var(--text-primary)]">{plan.price}</span>
                    {plan.period && (
                      <span className="text-xs text-[var(--text-tertiary)]">{plan.period}</span>
                    )}
                  </div>

                  <div className="space-y-2 mb-4 flex-1">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">Limits</div>
                    <div className="space-y-1">
                      <p className="text-xs text-[var(--text-secondary)]">
                        <span className="text-[var(--text-tertiary)]">Events:</span> {plan.limits.events}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        <span className="text-[var(--text-tertiary)]">Retention:</span> {plan.limits.retention}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        <span className="text-[var(--text-tertiary)]">Members:</span> {plan.limits.members}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        <span className="text-[var(--text-tertiary)]">Webhooks:</span> {plan.limits.webhooks}
                      </p>
                    </div>

                    <div className="pt-2 space-y-1.5">
                      <FeatureRow name="SSO / SAML" enabled={plan.gatedFeatures.sso} />
                      <FeatureRow name="Audit Logs" enabled={plan.gatedFeatures.auditLog} />
                      <FeatureRow name="Data Export" enabled={plan.gatedFeatures.dataExport} />
                      <FeatureRow name="Custom Roles" enabled={plan.gatedFeatures.customRoles} />
                    </div>

                    <div className="pt-2 space-y-1.5">
                      {plan.features.slice(0, 4).map((f) => (
                        <div key={f} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                          <Check className="w-3 h-3 text-[var(--accent-green)] flex-shrink-0" />
                          {f}
                        </div>
                      ))}
                      {plan.features.length > 4 && (
                        <p className="text-[10px] text-[var(--text-tertiary)]">
                          +{plan.features.length - 4} more features
                        </p>
                      )}
                    </div>
                  </div>

                  <Button
                    variant={isCurrent ? "outline" : tier === "enterprise" ? "default" : "outline"}
                    size="sm"
                    className="w-full"
                    disabled={isCurrent || isDowngrade}
                    onClick={() => handlePlanAction(tier)}
                  >
                    {isCurrent ? (
                      "Current Plan"
                    ) : isDowngrade ? (
                      "Current or lower"
                    ) : tier === "enterprise" ? (
                      <span className="flex items-center gap-1.5">
                        Contact Sales
                        <ArrowUpRight className="w-3 h-3" />
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        {plan.cta}
                        <ArrowUpRight className="w-3 h-3" />
                      </span>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
