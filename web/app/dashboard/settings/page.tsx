"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Save,
  Building2,
  Globe,
  Trash2,
  AlertTriangle,
  Upload,
  Sun,
  Moon,
  Monitor,
  Clock,
  Database,
  HardDrive,
  Flame,
  Zap,
  Activity,
  Check,
  Loader2,
  Archive,
  LogOut,
} from "lucide-react";
import { useTheme } from "next-themes";
import { fadeIn, staggerContainer, staggerItem } from "@/lib/animations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { api, ApiError } from "@/lib/api";
import { showSuccess, showError, showApiError } from "@/lib/toast";

interface OrgData {
  id: string;
  name: string;
  slug: string;
  plan: string;
  created_at: string;
  updated_at: string;
}

interface OrgUsage {
  member_count: number;
  key_count: number;
  plan: string;
  events_limit: number;
  created_at: string;
}

const planColors: Record<string, string> = {
  free: "bg-zinc-500/10 text-zinc-400",
  cloud: "bg-blue-500/10 text-blue-400",
  team: "bg-purple-500/10 text-purple-400",
  enterprise: "bg-amber-500/10 text-amber-400",
};

const planLabels: Record<string, string> = {
  free: "Self-Hosted",
  cloud: "Cloud",
  team: "Team",
  enterprise: "Enterprise",
};

const planPrices: Record<string, string> = {
  free: "Free",
  cloud: "$49/mo",
  team: "$199/mo",
  enterprise: "Custom",
};

const timezones = [
  { value: "America/New_York", label: "Eastern Time (US)" },
  { value: "America/Chicago", label: "Central Time (US)" },
  { value: "America/Denver", label: "Mountain Time (US)" },
  { value: "America/Los_Angeles", label: "Pacific Time (US)" },
  { value: "Europe/London", label: "London (GMT)" },
  { value: "Europe/Berlin", label: "Berlin (CET)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Asia/Kolkata", label: "Kolkata (IST)" },
  { value: "Australia/Sydney", label: "Sydney (AEST)" },
  { value: "UTC", label: "UTC" },
];

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [orgData, setOrgData] = useState<OrgData | null>(null);
  const [orgUsage, setOrgUsage] = useState<OrgUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [timezone, setTimezone] = useState("America/New_York");
  const [hotRetention, setHotRetention] = useState("14");
  const [warmRetention, setWarmRetention] = useState("90");
  const [blobRetention, setBlobRetention] = useState("30");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteOrg, setShowDeleteOrg] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const initToken = useCallback(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (token) {
      api.setToken(token);
    }
    return !!token;
  }, []);

  // Fetch org data on mount
  useEffect(() => {
    const fetchOrg = async () => {
      if (!initToken()) {
        setLoading(false);
        return;
      }

      try {
        const [org, usage] = await Promise.all([
          api.get<OrgData>("/api/org"),
          api.get<OrgUsage>("/api/org/usage"),
        ]);
        setOrgData(org);
        setOrgUsage(usage);
        setOrgName(org.name);
        setOrgSlug(org.slug);
      } catch (err) {
        if (err instanceof ApiError) {
          showApiError(err);
        } else {
          showError("Failed to load organization settings");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchOrg();
  }, [initToken]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);

    try {
      initToken();
      // NOTE: hot_retention_days, warm_retention_days, and blob_retention_days
      // require backend API support on PATCH /api/org. If the API does not yet
      // accept these fields it will silently ignore them; add corresponding
      // columns to the organizations table and update the org handler to persist
      // them when ready.
      const updated = await api.patch<OrgData>("/api/org", {
        name: orgName.trim(),
        slug: orgSlug.trim(),
        hot_retention_days: parseInt(hotRetention, 10),
        warm_retention_days: parseInt(warmRetention, 10),
        blob_retention_days: parseInt(blobRetention, 10),
      });
      setOrgData(updated);
      setOrgName(updated.name);
      setOrgSlug(updated.slug);
      setSaved(true);
      showSuccess("Settings saved successfully");
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      if (err instanceof ApiError) {
        showApiError(err);
      } else {
        showError("Failed to save settings");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteOrg = async () => {
    if (!orgData || deleteConfirmText !== orgData.slug) return;
    setDeleting(true);

    try {
      initToken();
      await api.delete("/api/org");
      showSuccess("Organization deleted. You will be redirected.");
      // Clear auth and redirect
      localStorage.removeItem("token");
      window.location.href = "/login";
    } catch (err) {
      if (err instanceof ApiError) {
        showApiError(err);
      } else {
        showError("Failed to delete organization");
      }
      setDeleting(false);
      setShowDeleteOrg(false);
      setDeleteConfirmText("");
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (token) {
      try {
        await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Best-effort: proceed with local cleanup even if API call fails
      }
    }
    localStorage.removeItem("token");
    window.location.href = "/login";
  };

  const plan = orgData?.plan || orgUsage?.plan || "free";
  const planLabel = planLabels[plan] || plan;
  const memberCount = orgUsage?.member_count ?? 0;
  const eventsLimit = orgUsage?.events_limit ?? 100000;
  // Events used is not yet tracked in the backend -- show 0 for now
  const eventsUsed = 0;
  const usagePercent = eventsLimit > 0 ? Math.round((eventsUsed / eventsLimit) * 100) : 0;
  const createdAt = orgData?.created_at || orgUsage?.created_at || "";

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <div className="h-6 w-48 bg-[var(--bg-hover)] rounded animate-pulse" />
          <div className="h-4 w-80 bg-[var(--bg-hover)] rounded animate-pulse mt-2" />
        </div>
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
          >
            <div className="h-5 w-40 bg-[var(--bg-hover)] rounded animate-pulse mb-4" />
            <div className="h-10 w-full bg-[var(--bg-hover)] rounded animate-pulse" />
          </div>
        ))}
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
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">General Settings</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Manage your organization profile, preferences, and account
        </p>
      </div>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-6"
      >
        {/* Organization Profile */}
        <motion.div
          variants={staggerItem}
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-lg bg-[var(--accent-blue)]/10 flex items-center justify-center">
              <Building2 className="w-4.5 h-4.5 text-[var(--accent-blue)]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Organization Profile</h2>
              <p className="text-xs text-[var(--text-tertiary)]">
                Basic details about your organization
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Logo upload placeholder */}
            <div className="md:col-span-2">
              <label className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-2 block">
                Organization Logo
              </label>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center text-white text-2xl font-bold">
                  {orgName.charAt(0) || "?"}
                </div>
                <div>
                  <Button variant="outline" size="sm">
                    <Upload className="w-3.5 h-3.5 mr-1.5" />
                    Upload Logo
                  </Button>
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-1.5">
                    Recommended: 256x256px, PNG or SVG
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                Organization Name
              </label>
              <Input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="bg-[var(--bg-primary)] border-[var(--border-default)]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                Slug
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--text-tertiary)] whitespace-nowrap">agentstack.dev/</span>
                <Input
                  value={orgSlug}
                  onChange={(e) =>
                    setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                  }
                  className="bg-[var(--bg-primary)] border-[var(--border-default)]"
                />
              </div>
            </div>
          </div>
        </motion.div>

        {/* Plan & Usage */}
        <motion.div
          variants={staggerItem}
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-lg bg-[var(--accent-purple)]/10 flex items-center justify-center">
              <Zap className="w-4.5 h-4.5 text-[var(--accent-purple)]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Plan & Usage</h2>
              <p className="text-xs text-[var(--text-tertiary)]">
                Your current subscription and resource usage
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)] mb-5">
            <div className="flex items-center gap-3">
              <Badge
                className={`${planColors[plan] || planColors.free} border-0 text-xs font-semibold`}
              >
                {planLabel}
              </Badge>
              <div>
                <p className="text-sm text-[var(--text-primary)] font-medium">
                  {planLabel} Plan
                </p>
                <p className="text-xs text-[var(--text-tertiary)]">
                  {planPrices[plan] || "Free"} &middot; {memberCount} member{memberCount !== 1 ? "s" : ""}
                  {createdAt ? (
                    <>
                      {" "}&middot; Since{" "}
                      {new Date(createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        year: "numeric",
                      })}
                    </>
                  ) : null}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href="/dashboard/settings/billing">Manage Plan</a>
            </Button>
          </div>

          {/* Usage bar */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[var(--text-tertiary)]" />
                <span className="text-sm text-[var(--text-primary)]">Events this month</span>
              </div>
              <span className="text-sm text-[var(--text-secondary)] tabular-nums">
                {(eventsUsed / 1000).toFixed(0)}K{" "}
                <span className="text-[var(--text-tertiary)]">/ {eventsLimit >= 1000000 ? `${(eventsLimit / 1000000).toFixed(0)}M` : `${(eventsLimit / 1000).toFixed(0)}K`}</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-[var(--bg-primary)] overflow-hidden border border-[var(--border-subtle)]">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${usagePercent}%` }}
                transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
                className={`h-full rounded-full ${
                  usagePercent > 95
                    ? "bg-[var(--accent-red)]"
                    : usagePercent > 80
                    ? "bg-[var(--accent-amber)]"
                    : "bg-[var(--accent-blue)]"
                }`}
              />
            </div>
            <p className="text-[10px] text-[var(--text-tertiary)]">
              {usagePercent}% of monthly limit used
            </p>
          </div>
        </motion.div>

        {/* Theme Preference */}
        <motion.div
          variants={staggerItem}
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-lg bg-[var(--accent-amber)]/10 flex items-center justify-center">
              <Sun className="w-4.5 h-4.5 text-[var(--accent-amber)]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Appearance</h2>
              <p className="text-xs text-[var(--text-tertiary)]">
                Choose how AgentStack looks to you
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 max-w-md">
            {(
              [
                { value: "light", label: "Light", icon: Sun },
                { value: "dark", label: "Dark", icon: Moon },
                { value: "system", label: "System", icon: Monitor },
              ] as const
            ).map((option) => {
              const Icon = option.icon;
              const isSelected = theme === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => setTheme(option.value)}
                  className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200 ${
                    isSelected
                      ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/5"
                      : "border-[var(--border-subtle)] bg-[var(--bg-primary)] hover:border-[var(--border-default)]"
                  }`}
                >
                  {isSelected && (
                    <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-[var(--accent-blue)] flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-white" />
                    </div>
                  )}
                  <Icon className={`w-5 h-5 ${isSelected ? "text-[var(--accent-blue)]" : "text-[var(--text-tertiary)]"}`} />
                  <span className={`text-xs font-medium ${isSelected ? "text-[var(--accent-blue)]" : "text-[var(--text-secondary)]"}`}>
                    {option.label}
                  </span>
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* Preferences */}
        <motion.div
          variants={staggerItem}
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-lg bg-[var(--accent-green)]/10 flex items-center justify-center">
              <Globe className="w-4.5 h-4.5 text-[var(--accent-green)]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Preferences</h2>
              <p className="text-xs text-[var(--text-tertiary)]">
                Configure timezone and data retention
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                Timezone
              </label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger className="bg-[var(--bg-primary)] border-[var(--border-default)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timezones.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-[var(--text-tertiary)]">
                All dates and times will be displayed in this timezone
              </p>
            </div>
            {/* Spacer for grid alignment */}
            <div className="hidden md:block" />
          </div>

          {/* Retention Tiers */}
          <div className="mt-6 pt-6 border-t border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-1">
              <Database className="w-4 h-4 text-[var(--text-tertiary)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Data Retention</h3>
            </div>
            <p className="text-xs text-[var(--text-tertiary)] mb-5">
              Configure how long each data tier is retained before automatic deletion or downsampling.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Hot Retention */}
              <div className="space-y-2 p-4 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)]">
                <label className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium flex items-center gap-1.5">
                  <Flame className="w-3 h-3 text-[var(--accent-red)]" />
                  Hot Retention
                </label>
                <Select value={hotRetention} onValueChange={setHotRetention}>
                  <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-default)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="14">14 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-[var(--text-tertiary)] leading-relaxed">
                  Full-resolution data retention. All spans, events, and metrics are stored at full granularity for fast querying.
                </p>
              </div>

              {/* Warm Retention */}
              <div className="space-y-2 p-4 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)]">
                <label className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium flex items-center gap-1.5">
                  <Archive className="w-3 h-3 text-[var(--accent-amber)]" />
                  Warm Retention
                </label>
                <Select value={warmRetention} onValueChange={setWarmRetention}>
                  <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-default)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="60">60 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                    <SelectItem value="180">180 days</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-[var(--text-tertiary)] leading-relaxed">
                  Downsampled data retention. Aggregated metrics and sampled spans are kept for trend analysis and historical queries.
                </p>
              </div>

              {/* Blob Retention */}
              <div className="space-y-2 p-4 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)]">
                <label className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium flex items-center gap-1.5">
                  <HardDrive className="w-3 h-3 text-[var(--accent-blue)]" />
                  Blob Retention
                </label>
                <Select value={blobRetention} onValueChange={setBlobRetention}>
                  <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-default)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="14">14 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="60">60 days</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-[var(--text-tertiary)] leading-relaxed">
                  Full payload retention. Raw request/response bodies and large payloads stored in blob storage before expiry.
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Save button */}
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Saving...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Save className="w-3.5 h-3.5" />
                Save Changes
              </span>
            )}
          </Button>
          {saved && (
            <motion.span
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-sm text-[var(--accent-green)]"
            >
              Settings saved successfully
            </motion.span>
          )}
        </div>

        {/* Sign Out */}
        <motion.div
          variants={staggerItem}
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[var(--bg-hover)] flex items-center justify-center">
                <LogOut className="w-4.5 h-4.5 text-[var(--text-tertiary)]" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Sign Out</h2>
                <p className="text-xs text-[var(--text-tertiary)]">
                  End your current session and return to the login screen
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleLogout} disabled={loggingOut}>
              {loggingOut ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Signing out...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out
                </span>
              )}
            </Button>
          </div>
        </motion.div>

        {/* Danger Zone */}
        <motion.div
          variants={staggerItem}
          className="rounded-xl border border-[var(--accent-red)]/20 bg-[var(--accent-red)]/[0.02] p-6"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-[var(--accent-red)]/10 flex items-center justify-center">
              <AlertTriangle className="w-4.5 h-4.5 text-[var(--accent-red)]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--accent-red)]">Danger Zone</h2>
              <p className="text-xs text-[var(--text-tertiary)]">
                Irreversible and destructive actions
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 rounded-lg border border-[var(--accent-red)]/10 bg-[var(--bg-primary)]">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Delete Organization</p>
              <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                Permanently remove this organization and all its data. This cannot be undone.
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteOrg(true)}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Delete
            </Button>
          </div>
        </motion.div>
      </motion.div>

      {/* Delete Organization Confirmation Dialog */}
      <Dialog open={showDeleteOrg} onOpenChange={(open) => { if (!open) { setShowDeleteOrg(false); setDeleteConfirmText(""); } }}>
        <DialogContent className="bg-[var(--bg-elevated)] border-[var(--border-default)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[var(--accent-red)]">
              <AlertTriangle className="w-5 h-5" />
              Delete Organization
            </DialogTitle>
            <DialogDescription>
              This action is permanent and cannot be undone. All data including sessions, traces,
              API keys, team members, and billing information will be permanently deleted.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-[var(--accent-red)]/5 border border-[var(--accent-red)]/10">
              <p className="text-xs text-[var(--text-secondary)]">
                To confirm, type <span className="font-mono font-semibold text-[var(--accent-red)]">{orgData?.slug || ""}</span> below:
              </p>
            </div>
            <Input
              placeholder={orgData?.slug || ""}
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              className="bg-[var(--bg-primary)] border-[var(--border-default)] font-mono"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDeleteOrg(false); setDeleteConfirmText(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteOrg}
              disabled={!orgData || deleteConfirmText !== orgData.slug || deleting}
            >
              {deleting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Deleting...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Trash2 className="w-3.5 h-3.5" />
                  Permanently Delete
                </span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
