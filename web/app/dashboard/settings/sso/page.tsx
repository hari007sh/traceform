"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Save,
  Trash2,
  AlertTriangle,
  Loader2,
  KeyRound,
  Globe,
  Shield,
  Zap,
  Check,
} from "lucide-react";
import { fadeIn, staggerContainer, staggerItem } from "@/lib/animations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface SSOConfig {
  id?: string;
  provider_type: "saml" | "oidc";
  // SAML
  idp_entity_id: string;
  idp_sso_url: string;
  certificate: string;
  sp_entity_id: string;
  acs_url: string;
  // OIDC
  issuer_url: string;
  client_id: string;
  client_secret: string;
  // Common
  email_domain: string;
  default_role: string;
  require_sso: boolean;
  enabled: boolean;
}

const emptySSOConfig: SSOConfig = {
  provider_type: "saml",
  idp_entity_id: "",
  idp_sso_url: "",
  certificate: "",
  sp_entity_id: "",
  acs_url: "",
  issuer_url: "",
  client_id: "",
  client_secret: "",
  email_domain: "",
  default_role: "viewer",
  require_sso: false,
  enabled: false,
};

export default function SSOSettingsPage() {
  const [config, setConfig] = useState<SSOConfig>(emptySSOConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);

  const initToken = useCallback(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (token) {
      api.setToken(token);
    }
    return !!token;
  }, []);

  useEffect(() => {
    const fetchSSO = async () => {
      if (!initToken()) {
        setLoading(false);
        return;
      }

      try {
        const data = await api.get<SSOConfig>("/api/sso");
        setConfig(data);
        setHasExisting(true);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // No SSO config yet — that's fine
        } else if (err instanceof ApiError) {
          showApiError(err);
        } else {
          showError("Failed to load SSO configuration");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchSSO();
  }, [initToken]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);

    try {
      initToken();
      const data = await api.post<SSOConfig>("/api/sso", config);
      setConfig(data);
      setHasExisting(true);
      setSaved(true);
      showSuccess("SSO configuration saved");
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      if (err instanceof ApiError) {
        showApiError(err);
      } else {
        showError("Failed to save SSO configuration");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);

    try {
      initToken();
      await api.delete("/api/sso");
      setConfig(emptySSOConfig);
      setHasExisting(false);
      showSuccess("SSO configuration deleted");
      setShowDeleteDialog(false);
    } catch (err) {
      if (err instanceof ApiError) {
        showApiError(err);
      } else {
        showError("Failed to delete SSO configuration");
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      initToken();
      await api.post("/api/sso/test", config);
      showSuccess("SSO connection test passed");
    } catch (err) {
      if (err instanceof ApiError) {
        showApiError(err);
      } else {
        showError("SSO connection test failed");
      }
    } finally {
      setTesting(false);
    }
  };

  const update = (field: keyof SSOConfig, value: string | boolean) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <div className="h-6 w-48 bg-[var(--bg-hover)] rounded animate-pulse" />
          <div className="h-4 w-80 bg-[var(--bg-hover)] rounded animate-pulse mt-2" />
        </div>
        {[1, 2, 3].map((i) => (
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
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">SSO Configuration</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Configure Single Sign-On for your organization using SAML or OIDC
        </p>
      </div>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-6"
      >
        {/* Provider Type Selector */}
        <motion.div
          variants={staggerItem}
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-lg bg-[var(--accent-blue)]/10 flex items-center justify-center">
              <KeyRound className="w-4.5 h-4.5 text-[var(--accent-blue)]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Provider Type</h2>
              <p className="text-xs text-[var(--text-tertiary)]">
                Choose your identity provider protocol
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 max-w-md">
            {(["saml", "oidc"] as const).map((type) => {
              const isSelected = config.provider_type === type;
              return (
                <button
                  key={type}
                  onClick={() => update("provider_type", type)}
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
                  <Shield className={`w-5 h-5 ${isSelected ? "text-[var(--accent-blue)]" : "text-[var(--text-tertiary)]"}`} />
                  <span className={`text-xs font-medium ${isSelected ? "text-[var(--accent-blue)]" : "text-[var(--text-secondary)]"}`}>
                    {type.toUpperCase()}
                  </span>
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* SAML Configuration */}
        {config.provider_type === "saml" && (
          <motion.div
            variants={staggerItem}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-9 h-9 rounded-lg bg-[var(--accent-purple)]/10 flex items-center justify-center">
                <Shield className="w-4.5 h-4.5 text-[var(--accent-purple)]" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">SAML Settings</h2>
                <p className="text-xs text-[var(--text-tertiary)]">
                  Configure your SAML identity provider
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                  IdP Entity ID
                </label>
                <Input
                  value={config.idp_entity_id}
                  onChange={(e) => update("idp_entity_id", e.target.value)}
                  placeholder="https://idp.example.com/entity"
                  className="bg-[var(--bg-primary)] border-[var(--border-default)]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                  IdP SSO URL
                </label>
                <Input
                  value={config.idp_sso_url}
                  onChange={(e) => update("idp_sso_url", e.target.value)}
                  placeholder="https://idp.example.com/sso"
                  className="bg-[var(--bg-primary)] border-[var(--border-default)]"
                />
              </div>
              <div className="md:col-span-2 space-y-2">
                <label className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                  X.509 Certificate
                </label>
                <Textarea
                  value={config.certificate}
                  onChange={(e) => update("certificate", e.target.value)}
                  placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                  rows={5}
                  className="bg-[var(--bg-primary)] border-[var(--border-default)] font-mono text-xs"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                  SP Entity ID
                  <span className="ml-2 text-[10px] normal-case tracking-normal text-[var(--text-tertiary)]">(auto-generated)</span>
                </label>
                <Input
                  value={config.sp_entity_id || "https://app.traceform.dev/saml/metadata"}
                  readOnly
                  className="bg-[var(--bg-primary)] border-[var(--border-default)] opacity-60 cursor-not-allowed"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                  ACS URL
                  <span className="ml-2 text-[10px] normal-case tracking-normal text-[var(--text-tertiary)]">(auto-generated)</span>
                </label>
                <Input
                  value={config.acs_url || "https://app.traceform.dev/auth/saml/callback"}
                  readOnly
                  className="bg-[var(--bg-primary)] border-[var(--border-default)] opacity-60 cursor-not-allowed"
                />
              </div>
            </div>
          </motion.div>
        )}

        {/* OIDC Configuration */}
        {config.provider_type === "oidc" && (
          <motion.div
            variants={staggerItem}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-9 h-9 rounded-lg bg-[var(--accent-purple)]/10 flex items-center justify-center">
                <Globe className="w-4.5 h-4.5 text-[var(--accent-purple)]" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">OIDC Settings</h2>
                <p className="text-xs text-[var(--text-tertiary)]">
                  Configure your OpenID Connect identity provider
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="md:col-span-2 space-y-2">
                <label className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                  Issuer URL
                </label>
                <Input
                  value={config.issuer_url}
                  onChange={(e) => update("issuer_url", e.target.value)}
                  placeholder="https://accounts.google.com"
                  className="bg-[var(--bg-primary)] border-[var(--border-default)]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                  Client ID
                </label>
                <Input
                  value={config.client_id}
                  onChange={(e) => update("client_id", e.target.value)}
                  placeholder="your-client-id"
                  className="bg-[var(--bg-primary)] border-[var(--border-default)]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                  Client Secret
                </label>
                <Input
                  type="password"
                  value={config.client_secret}
                  onChange={(e) => update("client_secret", e.target.value)}
                  placeholder="your-client-secret"
                  className="bg-[var(--bg-primary)] border-[var(--border-default)]"
                />
              </div>
            </div>
          </motion.div>
        )}

        {/* Common Settings */}
        <motion.div
          variants={staggerItem}
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-lg bg-[var(--accent-green)]/10 flex items-center justify-center">
              <Zap className="w-4.5 h-4.5 text-[var(--accent-green)]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Domain & Defaults</h2>
              <p className="text-xs text-[var(--text-tertiary)]">
                Configure email domain matching and default settings
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                Email Domain
              </label>
              <Input
                value={config.email_domain}
                onChange={(e) => update("email_domain", e.target.value)}
                placeholder="company.com"
                className="bg-[var(--bg-primary)] border-[var(--border-default)]"
              />
              <p className="text-[10px] text-[var(--text-tertiary)]">
                Users with this email domain will be prompted to use SSO
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                Default Role
              </label>
              <Select value={config.default_role} onValueChange={(v) => update("default_role", v)}>
                <SelectTrigger className="bg-[var(--bg-primary)] border-[var(--border-default)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-[var(--text-tertiary)]">
                Role assigned to new users signing in via SSO
              </p>
            </div>

            {/* Toggle: Require SSO */}
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                Require SSO
              </label>
              <button
                onClick={() => update("require_sso", !config.require_sso)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
                  config.require_sso
                    ? "bg-[var(--accent-blue)]"
                    : "bg-[var(--bg-hover)] border border-[var(--border-default)]"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                    config.require_sso ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
              <p className="text-[10px] text-[var(--text-tertiary)]">
                When enabled, users with this domain must use SSO to sign in
              </p>
            </div>

            {/* Toggle: Enable SSO */}
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                Enable SSO
              </label>
              <button
                onClick={() => update("enabled", !config.enabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
                  config.enabled
                    ? "bg-[var(--accent-green)]"
                    : "bg-[var(--bg-hover)] border border-[var(--border-default)]"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                    config.enabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
              <p className="text-[10px] text-[var(--text-tertiary)]">
                SSO must be enabled for users to sign in with it
              </p>
            </div>
          </div>
        </motion.div>

        {/* Action Buttons */}
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
                Save Configuration
              </span>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={testing || !config.email_domain}
          >
            {testing ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Testing...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Zap className="w-3.5 h-3.5" />
                Test Connection
              </span>
            )}
          </Button>
          {saved && (
            <motion.span
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-sm text-[var(--accent-green)]"
            >
              Configuration saved
            </motion.span>
          )}
        </div>

        {/* Danger Zone */}
        {hasExisting && (
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
                  Permanently remove SSO configuration
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg border border-[var(--accent-red)]/10 bg-[var(--bg-primary)]">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Delete SSO Configuration</p>
                <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                  Users will no longer be able to sign in with SSO. This cannot be undone.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                Delete
              </Button>
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={(open) => { if (!open) setShowDeleteDialog(false); }}>
        <DialogContent className="bg-[var(--bg-elevated)] border-[var(--border-default)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[var(--accent-red)]">
              <AlertTriangle className="w-5 h-5" />
              Delete SSO Configuration
            </DialogTitle>
            <DialogDescription>
              This will permanently remove your SSO configuration. Users will no longer be able
              to sign in using SSO. Are you sure you want to continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Deleting...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Configuration
                </span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
