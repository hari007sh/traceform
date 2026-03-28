"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Server,
  Plus,
  CheckCircle2,
  XCircle,
  Key,
  AlertCircle,
  RefreshCw,
  Pencil,
  Zap,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  fadeIn,
  staggerContainer,
  staggerItem,
} from "@/lib/animations";
import { SkeletonBlock } from "@/components/skeleton";
import { RequireRole } from "@/components/require-role";
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
import type { Provider } from "@/lib/types";

const providerColors: Record<string, string> = {
  openai: "var(--accent-green)",
  anthropic: "var(--accent-amber)",
  google: "var(--accent-blue)",
  together: "var(--accent-purple)",
  groq: "var(--healing-blue)",
  mistral: "var(--accent-red)",
};

const providerDisplayNames: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google AI",
  together: "Together AI",
  groq: "Groq",
  mistral: "Mistral AI",
};

function formatCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

export default function ProvidersPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formName, setFormName] = useState("openai");
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  // Edit dialog state
  const [editTarget, setEditTarget] = useState<Provider | null>(null);
  const [editApiKey, setEditApiKey] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [changeApiKey, setChangeApiKey] = useState(false);
  const [showEditApiKey, setShowEditApiKey] = useState(false);
  const [saving, setSaving] = useState(false);

  // Test connection state
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, "success" | "failed">>({});

  const initToken = useCallback(() => {
    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("token")
        : null;
    if (token) {
      api.setToken(token);
    }
  }, []);

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    initToken();

    try {
      const data = await api.get<{ providers: Provider[] }>("/v1/gateway/providers");
      setProviders(data.providers ?? []);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || "Failed to load providers.");
      } else {
        setError("An unexpected error occurred.");
      }
    } finally {
      setLoading(false);
    }
  }, [initToken]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const handleCreate = async () => {
    if (!formName.trim()) {
      showError("Provider name is required.");
      return;
    }
    if (!formApiKey.trim()) {
      showError("API key is required.");
      return;
    }

    setCreating(true);
    initToken();
    try {
      const result = await api.post<Provider>("/v1/gateway/providers", {
        name: formName.trim(),
        display_name: (formDisplayName.trim() || providerDisplayNames[formName] || formName).trim(),
        api_key: formApiKey.trim(),
        base_url: formBaseUrl.trim() || undefined,
        is_enabled: true,
      });

      setProviders((prev) => [result, ...prev]);
      setCreateOpen(false);
      resetCreateForm();
      showSuccess(`Provider "${result.display_name}" added successfully.`);
    } catch (err) {
      if (err instanceof ApiError) {
        showApiError(err);
      } else {
        showError("Failed to add provider.");
      }
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = async () => {
    if (!editTarget) return;

    setSaving(true);
    initToken();
    try {
      const body: Record<string, unknown> = {
        display_name: editDisplayName.trim() || editTarget.display_name,
        base_url: editBaseUrl.trim() || undefined,
      };
      if (changeApiKey && editApiKey.trim()) {
        body.api_key = editApiKey.trim();
      }

      const updated = await api.put<Provider>(
        `/v1/gateway/providers/${editTarget.id}`,
        body
      );

      setProviders((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
      setEditTarget(null);
      resetEditForm();
      showSuccess(`Provider "${updated.display_name}" updated.`);
    } catch (err) {
      if (err instanceof ApiError) {
        showApiError(err);
      } else {
        showError("Failed to update provider.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async (providerId: string) => {
    setTesting(providerId);
    initToken();
    try {
      await api.post(`/v1/gateway/providers/${providerId}/test`);
      setTestResults((prev) => ({ ...prev, [providerId]: "success" }));
      showSuccess("Connection test passed.");
    } catch {
      setTestResults((prev) => ({ ...prev, [providerId]: "failed" }));
      showError("Connection test failed. Check your API key and try again.");
    } finally {
      setTesting(null);
    }
  };

  const resetCreateForm = () => {
    setFormName("openai");
    setFormDisplayName("");
    setFormApiKey("");
    setFormBaseUrl("");
    setShowApiKey(false);
  };

  const resetEditForm = () => {
    setEditApiKey("");
    setEditBaseUrl("");
    setEditDisplayName("");
    setChangeApiKey(false);
    setShowEditApiKey(false);
  };

  const openEditDialog = (provider: Provider) => {
    setEditTarget(provider);
    setEditDisplayName(provider.display_name);
    setEditBaseUrl((provider.config?.base_url as string) || "");
    setChangeApiKey(false);
    setEditApiKey("");
    setShowEditApiKey(false);
  };

  const hasApiKey = (provider: Provider): boolean => {
    return !!provider.config?.has_api_key;
  };

  const isEmpty = !loading && !error && providers.length === 0;

  return (
    <motion.div
      variants={fadeIn}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Providers</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Manage LLM provider connections and API keys
          </p>
        </div>
        <RequireRole role="admin">
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent-blue)] text-white text-sm font-medium hover:opacity-90 transition-opacity active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            Add Provider
          </button>
        </RequireRole>
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
            >
              <div className="flex items-center gap-3 mb-4">
                <SkeletonBlock className="w-10 h-10 rounded-lg" />
                <div>
                  <SkeletonBlock className="h-4 w-24 mb-1" />
                  <SkeletonBlock className="h-3 w-16" />
                </div>
              </div>
              <div className="flex gap-4">
                <SkeletonBlock className="h-3 w-20" />
                <SkeletonBlock className="h-3 w-20" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="rounded-xl border border-[var(--accent-red)]/20 bg-[var(--accent-red)]/5 p-6">
          <div className="flex items-center gap-3 mb-3">
            <AlertCircle className="w-5 h-5 text-[var(--accent-red)]" />
            <h3 className="text-sm font-medium text-[var(--accent-red)]">
              Failed to load providers
            </h3>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mb-4">{error}</p>
          <button
            onClick={fetchProviders}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-sm font-medium hover:bg-[var(--bg-hover)] transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      )}

      {/* Empty State */}
      {isEmpty && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-16 text-center">
          <div className="w-12 h-12 rounded-xl bg-[var(--accent-blue)]/10 flex items-center justify-center mx-auto mb-4">
            <Server className="w-6 h-6 text-[var(--accent-blue)]" />
          </div>
          <h3 className="text-sm font-medium mb-1">No providers configured</h3>
          <p className="text-xs text-[var(--text-tertiary)] max-w-sm mx-auto mb-4">
            Add an LLM provider to start routing requests through the gateway.
          </p>
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent-blue)] text-white text-sm font-medium hover:bg-[var(--accent-blue)]/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Provider
          </button>
        </div>
      )}

      {/* Provider Cards Grid */}
      {!loading && !error && providers.length > 0 && (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {providers.map((provider) => {
            const color =
              providerColors[provider.name] || "var(--text-tertiary)";
            const keyConfigured = hasApiKey(provider);
            const testResult = testResults[provider.id];

            return (
              <motion.div
                key={provider.id}
                variants={staggerItem}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--border-default)] transition-colors group"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {/* Provider Icon */}
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
                        color: color,
                      }}
                    >
                      {provider.display_name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {provider.display_name}
                      </p>
                      <p className="text-[10px] text-[var(--text-tertiary)] font-mono">
                        {provider.name}
                      </p>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="flex items-center gap-1.5">
                    {provider.is_enabled ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-[var(--accent-green)]" />
                        <span className="text-xs text-[var(--accent-green)]">
                          Enabled
                        </span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                        <span className="text-xs text-[var(--text-tertiary)]">
                          Disabled
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* API Key Status */}
                <div className="flex items-center gap-2 mb-4">
                  <Key className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                  {keyConfigured ? (
                    <span className="text-xs text-[var(--accent-green)] flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)]" />
                      Key configured
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--accent-amber)] flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-amber)]" />
                      No key
                    </span>
                  )}
                  {testResult === "success" && (
                    <span className="text-[10px] text-[var(--accent-green)] bg-[var(--accent-green)]/10 px-1.5 py-0.5 rounded ml-auto">
                      Verified
                    </span>
                  )}
                  {testResult === "failed" && (
                    <span className="text-[10px] text-[var(--accent-red)] bg-[var(--accent-red)]/10 px-1.5 py-0.5 rounded ml-auto">
                      Failed
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-3 border-t border-[var(--border-subtle)]">
                  <button
                    onClick={() => handleTestConnection(provider.id)}
                    disabled={testing === provider.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--bg-primary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
                  >
                    {testing === provider.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Zap className="w-3 h-3" />
                    )}
                    Test Connection
                  </button>
                  <button
                    onClick={() => openEditDialog(provider)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--bg-primary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors ml-auto opacity-0 group-hover:opacity-100"
                  >
                    <Pencil className="w-3 h-3" />
                    Edit
                  </button>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* Add Provider Dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            resetCreateForm();
          }
        }}
      >
        <DialogContent className="bg-[var(--bg-elevated)] border-[var(--border-subtle)]">
          <DialogHeader>
            <DialogTitle>Add Provider</DialogTitle>
            <DialogDescription>
              Connect a new LLM provider. Your API key is encrypted
              (AES-256-GCM) before storage.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Provider selection */}
            <div>
              <label className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider font-medium mb-1.5 block">
                Provider *
              </label>
              <select
                value={formName}
                onChange={(e) => {
                  setFormName(e.target.value);
                  setFormDisplayName(
                    providerDisplayNames[e.target.value] || ""
                  );
                }}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="google">Google AI</option>
                <option value="together">Together AI</option>
                <option value="groq">Groq</option>
                <option value="mistral">Mistral AI</option>
              </select>
            </div>

            {/* Display Name */}
            <div>
              <label className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider font-medium mb-1.5 block">
                Display Name
              </label>
              <input
                type="text"
                value={formDisplayName}
                onChange={(e) => setFormDisplayName(e.target.value)}
                placeholder={providerDisplayNames[formName] || "Provider name"}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]"
              />
            </div>

            {/* API Key */}
            <div>
              <label className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider font-medium mb-1.5 block">
                API Key *
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={formApiKey}
                  onChange={(e) => setFormApiKey(e.target.value)}
                  placeholder="sk-... (encrypted before storage)"
                  className="w-full px-3 py-2 pr-10 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)] font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                >
                  {showApiKey ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
                Your API key is encrypted (AES-256-GCM) before storage. It is
                never shown in the UI after saving.
              </p>
            </div>

            {/* Base URL (optional) */}
            <div>
              <label className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider font-medium mb-1.5 block">
                Base URL (optional)
              </label>
              <input
                type="text"
                value={formBaseUrl}
                onChange={(e) => setFormBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)] font-mono"
              />
              <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
                Override the default API endpoint. Leave blank for the
                provider default.
              </p>
            </div>
          </div>

          <DialogFooter>
            <button
              onClick={() => {
                setCreateOpen(false);
                resetCreateForm();
              }}
              className="px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-sm font-medium hover:bg-[var(--bg-hover)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !formName.trim() || !formApiKey.trim()}
              className="px-4 py-2 rounded-lg bg-[var(--accent-blue)] text-white text-sm font-medium hover:bg-[var(--accent-blue)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? "Adding..." : "Add Provider"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Provider Dialog */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null);
            resetEditForm();
          }
        }}
      >
        <DialogContent className="bg-[var(--bg-elevated)] border-[var(--border-subtle)]">
          <DialogHeader>
            <DialogTitle>Edit Provider</DialogTitle>
            <DialogDescription>
              Update settings for {editTarget?.display_name || "this provider"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Display Name */}
            <div>
              <label className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider font-medium mb-1.5 block">
                Display Name
              </label>
              <input
                type="text"
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]"
              />
            </div>

            {/* API Key */}
            <div>
              <label className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider font-medium mb-1.5 block">
                API Key
              </label>
              {!changeApiKey ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[var(--accent-green)] flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5" />
                    API key is set
                  </span>
                  <button
                    onClick={() => setChangeApiKey(true)}
                    className="text-xs text-[var(--accent-blue)] hover:underline"
                  >
                    (change)
                  </button>
                </div>
              ) : (
                <div>
                  <div className="relative">
                    <input
                      type={showEditApiKey ? "text" : "password"}
                      value={editApiKey}
                      onChange={(e) => setEditApiKey(e.target.value)}
                      placeholder="Enter new API key"
                      className="w-full px-3 py-2 pr-10 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)] font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowEditApiKey(!showEditApiKey)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                    >
                      {showEditApiKey ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      setChangeApiKey(false);
                      setEditApiKey("");
                    }}
                    className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] mt-1.5"
                  >
                    Cancel change
                  </button>
                </div>
              )}
            </div>

            {/* Base URL */}
            <div>
              <label className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider font-medium mb-1.5 block">
                Base URL (optional)
              </label>
              <input
                type="text"
                value={editBaseUrl}
                onChange={(e) => setEditBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)] font-mono"
              />
            </div>
          </div>

          <DialogFooter>
            <button
              onClick={() => {
                setEditTarget(null);
                resetEditForm();
              }}
              className="px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-sm font-medium hover:bg-[var(--bg-hover)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleEdit}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-[var(--accent-blue)] text-white text-sm font-medium hover:bg-[var(--accent-blue)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
