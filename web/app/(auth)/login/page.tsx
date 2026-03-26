"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Github, Mail, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fadeIn } from "@/lib/animations";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

// ---------------------------------------------------------------------------
// Inner component that uses useSearchParams (needs Suspense)
// ---------------------------------------------------------------------------
function LoginContent() {
  const searchParams = useSearchParams();
  const calledRef = useRef(false);

  const [ssoEmail, setSsoEmail] = useState("");
  const [ssoLoading, setSsoLoading] = useState(false);
  const [ssoError, setSsoError] = useState("");

  // Handle SSO callback: if ?token=JWT is in the URL, store and redirect
  useEffect(() => {
    if (calledRef.current) return;
    const token = searchParams.get("token");
    if (token) {
      calledRef.current = true;
      localStorage.setItem("token", token);
      window.location.href = "/dashboard/overview";
    }
  }, [searchParams]);

  const handleGitHubLogin = async () => {
    try {
      const res = await fetch(`${API_URL}/auth/github`, { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      // GitHub OAuth not configured, redirect to dashboard for dev
      window.location.href = "/dashboard/overview";
    }
  };

  const handleSSOLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSsoError("");
    const email = ssoEmail.trim();
    if (!email) return;

    setSsoLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/auth/sso/lookup?email=${encodeURIComponent(email)}`
      );
      const data = await res.json();

      if (res.ok && data.redirect_url) {
        window.location.href = data.redirect_url;
      } else {
        setSsoError(data.error?.message || "No SSO configured for this domain");
      }
    } catch {
      setSsoError("Failed to look up SSO configuration");
    } finally {
      setSsoLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
      <motion.div
        variants={fadeIn}
        initial="hidden"
        animate="visible"
        className="w-full max-w-sm mx-auto p-8"
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center mb-4">
            <span className="text-white font-bold text-xl">A</span>
          </div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">AgentStack</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Sign in to your account
          </p>
        </div>

        {/* GitHub Login */}
        <Button
          onClick={handleGitHubLogin}
          className="w-full h-11 bg-white text-black hover:bg-gray-100 font-medium"
        >
          <Github className="w-5 h-5 mr-2" />
          Sign in with GitHub
        </Button>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-[var(--border-subtle)]" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-[var(--bg-primary)] px-3 text-[var(--text-tertiary)]">or</span>
          </div>
        </div>

        {/* SSO Login */}
        <form onSubmit={handleSSOLookup} className="space-y-3">
          <div className="space-y-1.5">
            <Input
              type="email"
              value={ssoEmail}
              onChange={(e) => {
                setSsoEmail(e.target.value);
                setSsoError("");
              }}
              placeholder="you@company.com"
              className="h-11 bg-[var(--bg-secondary)] border-[var(--border-default)] text-sm"
            />
          </div>

          {ssoError && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2 p-3 rounded-lg bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/20"
            >
              <AlertCircle className="w-4 h-4 text-[var(--accent-red)] mt-0.5 flex-shrink-0" />
              <p className="text-xs text-[var(--accent-red)]">{ssoError}</p>
            </motion.div>
          )}

          <Button
            type="submit"
            variant="outline"
            className="w-full h-11 font-medium"
            disabled={ssoLoading || !ssoEmail.trim()}
          >
            {ssoLoading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Looking up...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Continue with SSO
              </span>
            )}
          </Button>
        </form>

        <p className="text-xs text-[var(--text-tertiary)] text-center mt-6">
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </p>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page wrapper with Suspense boundary (useSearchParams requires it)
// ---------------------------------------------------------------------------
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
          <div className="w-8 h-8 border-2 border-[var(--accent-blue)] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
