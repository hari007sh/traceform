"use client";

import { motion } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fadeIn } from "@/lib/animations";

export default function InviteInvalidPage() {
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
          Invalid Invite
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mb-6">
          This invite link is invalid or has been revoked. Please ask the team
          owner to send a new invite.
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
