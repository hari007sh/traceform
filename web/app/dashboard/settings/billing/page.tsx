"use client";

import { motion } from "framer-motion";
import { useState } from "react";
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
  Server,
  KeyRound,
  Calendar,
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
    name: "Community",
    price: "Free",
    period: "forever",
    features: [
      "All 6 modules",
      "Basic RBAC (admin/viewer)",
      "Community support",
      "Self-managed infrastructure",
    ],
    limits: { events: "Unlimited", retention: "7 days", members: "3", webhooks: "2" },
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
      "Automatic updates & backups",
      "No infrastructure to maintain",
    ],
    limits: { events: "100K/mo", retention: "7 days", members: "3", webhooks: "10" },
    gatedFeatures: { sso: false, auditLog: false, dataExport: false, customRoles: false },
    cta: "Upgrade",
    stripeUrl: "https://billing.stripe.com/p/login/traceform-cloud",
  },
  team: {
    name: "Team",
    price: "$199",
    period: "/month",
    features: [
      "Everything in Community, plus:",
      "Audit logging",
      "Data export (CSV/JSON)",
      "Error groups",
      "Budget enforcement",
      "Email support",
    ],
    limits: { events: "Unlimited", retention: "90 days", members: "25", webhooks: "100" },
    gatedFeatures: { sso: false, auditLog: true, dataExport: true, customRoles: false },
    highlight: true,
    cta: "Upgrade",
    stripeUrl: "https://billing.stripe.com/p/login/traceform-team",
  },
  enterprise: {
    name: "Enterprise",
    price: "Custom",
    period: "",
    features: [
      "Everything in Team, plus:",
      "SSO (SAML/OIDC)",
      "Custom roles",
      "SLA guarantee",
      "Dedicated support",
      "On-prem deployment assistance",
    ],
    limits: { events: "Unlimited", retention: "Custom", members: "Unlimited", webhooks: "Unlimited" },
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
  free: "Community",
  cloud: "Cloud",
  team: "Team",
  enterprise: "Enterprise",
};

function handlePlanAction(tier: PlanTier) {
  const plan = allPlans[tier];
  if (tier === "enterprise") {
    window.location.href = "mailto:sales@traceform.dev?subject=Traceform%20Enterprise%20Inquiry";
    return;
  }
  if (plan.stripeUrl) {
    window.open(plan.stripeUrl, "_blank");
    return;
  }
  showSuccess("Contact sales@traceform.dev to change plans");
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
  const currentPlanDisplay = planDisplayNames[currentTier] || "Community";
  const currentPlanData = allPlans[currentTier] || allPlans.free;
  const [licenseKey, setLicenseKey] = useState("");
  const [licenseSubmitting, setLicenseSubmitting] = useState(false);
  const isSelfHosted = currentTier === "free" || currentTier === "team" || currentTier === "enterprise";
  const isCloud = currentTier === "cloud";

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
      initial={false}
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
        initial={false}
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
                  {isSelfHosted
                    ? `Self-hosted ${currentPlanDisplay} Edition (BSL 1.1)`
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

        {/* License Key (self-hosted only) */}
        {isSelfHosted && (
          <motion.div
            variants={staggerItem}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-[var(--accent-green)]/10 flex items-center justify-center">
                <KeyRound className="w-4 h-4 text-[var(--accent-green)]" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">License Key</h2>
                <p className="text-xs text-[var(--text-tertiary)]">
                  {currentTier === "free"
                    ? "Enter a license key to unlock Team or Enterprise features"
                    : `Your ${currentPlanDisplay} license is active`}
                </p>
              </div>
            </div>

            {currentTier !== "free" && (
              <div className="mb-4 p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[var(--accent-green)] animate-pulse" />
                    <span className="text-xs font-medium text-[var(--text-primary)]">License Active</span>
                  </div>
                  <Badge className={`${planColors[currentTier]} border-0 text-[10px] uppercase tracking-wider font-semibold`}>
                    {currentPlanDisplay}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 text-xs text-[var(--text-secondary)]">
                  <div className="flex items-center gap-1.5">
                    <Server className="w-3 h-3 text-[var(--text-tertiary)]" />
                    <span>Self-Hosted</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3 h-3 text-[var(--text-tertiary)]" />
                    <span>Renews monthly</span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                placeholder="tf_lic_..."
                className="flex-1 h-9 px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)] font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={!licenseKey.startsWith("tf_lic_") || licenseSubmitting}
                onClick={() => {
                  setLicenseSubmitting(true);
                  // Simulate license activation
                  setTimeout(() => {
                    setLicenseSubmitting(false);
                    showSuccess("License key activated. Restart your instance to apply changes.");
                    setLicenseKey("");
                  }, 1500);
                }}
              >
                {licenseSubmitting ? "Activating..." : "Activate"}
              </Button>
            </div>

            <p className="mt-2 text-[10px] text-[var(--text-tertiary)]">
              Set <code className="font-mono bg-[var(--bg-hover)] px-1 py-0.5 rounded">TRACEFORM_LICENSE_KEY</code> in your .env file, or enter a key above to activate via the dashboard.
            </p>

            {currentTier === "free" && (
              <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                <p className="text-xs text-[var(--text-secondary)] mb-2">
                  You are running <span className="font-semibold text-[var(--text-primary)]">Traceform Community Edition</span>. Upgrade to Team for audit logs, data export, error groups, and more.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open("https://traceform.dev/pricing", "_blank")}
                >
                  <span className="flex items-center gap-1.5">
                    Upgrade to Team
                    <ArrowUpRight className="w-3 h-3" />
                  </span>
                </Button>
              </div>
            )}
          </motion.div>
        )}

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
                {isSelfHosted
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
                  {isSelfHosted
                    ? "License keys are managed via .env or the dashboard"
                    : "Update your card details"}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                isSelfHosted
                  ? showSuccess("License keys are managed via TRACEFORM_LICENSE_KEY in .env")
                  : showSuccess("Stripe billing portal coming soon")
              }
            >
              {isSelfHosted ? "Manage License" : "Update"}
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
                    {isSelfHosted ? "No invoices for self-hosted" : "View and download invoices"}
                  </p>
                </div>
              </div>
              {!isSelfHosted && (
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
