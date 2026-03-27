"use client";

import { motion } from "framer-motion";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fadeIn } from "@/lib/animations";

export default function InviteExpiredPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
      <motion.div
        variants={fadeIn}
        initial="hidden"
        animate="visible"
        className="w-full max-w-md mx-auto p-8 text-center"
      >
        <div className="w-12 h-12 rounded-xl bg-[var(--accent-amber)]/10 flex items-center justify-center mx-auto mb-4">
          <Clock className="w-6 h-6 text-[var(--accent-amber)]" />
        </div>
        <h1 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
          Invite Expired
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mb-6">
          This invite link has expired. Invites are valid for 7 days. Please ask
          the team owner to send a new invite.
        </p>
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
