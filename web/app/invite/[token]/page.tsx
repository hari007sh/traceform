"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { Github, Users, ShieldCheck, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fadeIn } from "@/lib/animations";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

interface InviteInfo {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  org_name: string;
  invited_by: string;
  expires_at: string;
  created_at: string;
}

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchInvite = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/auth/invite/${token}/info`);
      if (!res.ok) {
        setError("This invite link is invalid or has been revoked.");
        return;
      }
      const data: InviteInfo = await res.json();
      if (data.status === "expired") {
        setError("This invite has expired. Please ask the team owner to send a new one.");
        return;
      }
      if (data.status === "accepted") {
        setError("This invite has already been accepted.");
        return;
      }
      setInvite(data);
    } catch {
      setError("Failed to load invite details. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      fetchInvite();
    }
  }, [token, fetchInvite]);

  const handleAccept = () => {
    // Store the invite token so the callback page can pass it through
    localStorage.setItem("pending_invite", token);
    // Redirect to GitHub OAuth login
    fetch(`${API_URL}/auth/github`, { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (data.url) {
          window.location.href = data.url;
        } else {
          setError("GitHub OAuth is not configured. Please contact the administrator.");
        }
      })
      .catch(() => {
        setError("Failed to initiate login. Please try again.");
      });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-[var(--accent-blue)] animate-spin mx-auto mb-4" />
          <p className="text-sm text-[var(--text-secondary)]">Loading invite...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <motion.div
          variants={fadeIn}
          initial="hidden"
          animate="visible"
          className="w-full max-w-md mx-auto p-8 text-center"
        >
          <div className="w-12 h-12 rounded-xl bg-[var(--accent-red)]/10 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6 text-[var(--accent-red)]" />
          </div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            Invite Unavailable
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mb-6">{error}</p>
          <Button
            variant="outline"
            onClick={() => (window.location.href = "/login")}
          >
            Go to Login
          </Button>
        </motion.div>
      </div>
    );
  }

  if (!invite) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
      <motion.div
        variants={fadeIn}
        initial="hidden"
        animate="visible"
        className="w-full max-w-md mx-auto p-8"
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center mb-4">
            <span className="text-white font-bold text-xl">T</span>
          </div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            Traceform
          </h1>
        </div>

        {/* Invite card */}
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm text-[var(--text-secondary)]">
                You have been invited to join
              </p>
              <p className="text-base font-semibold text-[var(--text-primary)]">
                {invite.org_name || "a team"}
              </p>
            </div>
          </div>

          <div className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--text-tertiary)]">Role</span>
              <Badge className="bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] border-[var(--accent-blue)]/20 border text-xs uppercase tracking-wider font-semibold">
                <ShieldCheck className="w-3 h-3 mr-1" />
                {invite.role}
              </Badge>
            </div>
            {invite.invited_by && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--text-tertiary)]">Invited by</span>
                <span className="text-[var(--text-primary)]">
                  {invite.invited_by}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--text-tertiary)]">Email</span>
              <span className="text-[var(--text-primary)]">{invite.email}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--text-tertiary)]">Expires</span>
              <span className="text-[var(--text-primary)]">
                {new Date(invite.expires_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </div>
          </div>
        </div>

        {/* Accept button */}
        <Button
          onClick={handleAccept}
          className="w-full h-11 bg-white text-black hover:bg-gray-100 font-medium"
        >
          <Github className="w-5 h-5 mr-2" />
          Accept Invite with GitHub
        </Button>

        <p className="text-xs text-[var(--text-tertiary)] text-center mt-4">
          By accepting, you agree to the Terms of Service and Privacy Policy.
        </p>
      </motion.div>
    </div>
  );
}
