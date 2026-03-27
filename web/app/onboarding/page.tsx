"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Copy,
  Key,
  Code,
  Radio,
  PartyPopper,
  Sparkles,
  Terminal,
  Eye,
  EyeOff,
  Loader2,
  Shield,
  ChevronRight,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TOTAL_STEPS = 5;
const POLL_INTERVAL = 2000;
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

/* ------------------------------------------------------------------ */
/*  Animation variants                                                 */
/* ------------------------------------------------------------------ */

const stepVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 40 : -40,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.35, ease: "easeOut" as const },
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -40 : 40,
    opacity: 0,
    transition: { duration: 0.25, ease: "easeIn" as const },
  }),
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};

/* ------------------------------------------------------------------ */
/*  Confetti component (lightweight CSS confetti)                      */
/* ------------------------------------------------------------------ */

function Confetti() {
  const pieces = Array.from({ length: 40 }, (_, i) => i);
  const colors = ["#3b82f6", "#22c55e", "#a855f7", "#38bdf8", "#f59e0b", "#ef4444"];

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {pieces.map((i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.8;
        const duration = 1.5 + Math.random() * 2;
        const color = colors[i % colors.length];
        const size = 6 + Math.random() * 6;
        const rotation = Math.random() * 360;

        return (
          <motion.div
            key={i}
            initial={{ y: -20, x: 0, opacity: 1, rotate: 0 }}
            animate={{
              y: typeof window !== "undefined" ? window.innerHeight + 40 : 900,
              x: (Math.random() - 0.5) * 200,
              opacity: [1, 1, 0],
              rotate: rotation + 360 * (Math.random() > 0.5 ? 1 : -1),
            }}
            transition={{
              duration,
              delay,
              ease: "easeIn",
            }}
            className="absolute"
            style={{
              left: `${left}%`,
              width: size,
              height: size,
              backgroundColor: color,
              borderRadius: Math.random() > 0.5 ? "50%" : "2px",
            }}
          />
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Code block with copy & language tabs                               */
/* ------------------------------------------------------------------ */

function CodeSnippet({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  return (
    <div className="relative rounded-xl border border-[var(--border-subtle)] bg-[#0d0d14] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
          {language}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-[var(--accent-green)]" />
              <span className="text-[var(--accent-green)]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-sm leading-relaxed">
        <code className="font-mono text-[var(--text-secondary)]">{code}</code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step indicator                                                     */
/* ------------------------------------------------------------------ */

function StepIndicator({
  currentStep,
  totalSteps,
}: {
  currentStep: number;
  totalSteps: number;
}) {
  const steps = [
    { label: "Welcome", icon: Sparkles },
    { label: "API Key", icon: Key },
    { label: "Install", icon: Code },
    { label: "Verify", icon: Radio },
    { label: "Done", icon: PartyPopper },
  ];

  return (
    <div className="w-full">
      {/* Progress bar */}
      <div className="relative h-1 bg-[var(--bg-hover)] rounded-full mb-6 overflow-hidden">
        <motion.div
          className="absolute inset-y-0 left-0 bg-[var(--accent-blue)] rounded-full"
          initial={false}
          animate={{ width: `${((currentStep - 1) / (totalSteps - 1)) * 100}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>

      {/* Step dots */}
      <div className="flex items-center justify-between">
        {steps.map((step, i) => {
          const stepNum = i + 1;
          const Icon = step.icon;
          const isActive = stepNum === currentStep;
          const isCompleted = stepNum < currentStep;

          return (
            <div key={step.label} className="flex flex-col items-center gap-1.5">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                  isCompleted
                    ? "bg-[var(--accent-green)] text-white"
                    : isActive
                    ? "bg-[var(--accent-blue)] text-white"
                    : "bg-[var(--bg-hover)] text-[var(--text-tertiary)]"
                }`}
              >
                {isCompleted ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Icon className="w-3.5 h-3.5" />
                )}
              </div>
              <span
                className={`text-[10px] uppercase tracking-wider font-medium hidden sm:block ${
                  isActive
                    ? "text-[var(--text-primary)]"
                    : isCompleted
                    ? "text-[var(--accent-green)]"
                    : "text-[var(--text-tertiary)]"
                }`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 1: Welcome                                                    */
/* ------------------------------------------------------------------ */

function WelcomeStep() {
  return (
    <div className="text-center py-8">
      <div className="w-16 h-16 rounded-2xl bg-[var(--accent-blue)]/10 flex items-center justify-center mx-auto mb-6">
        <Shield className="w-8 h-8 text-[var(--accent-blue)]" />
      </div>
      <h2 className="text-2xl md:text-3xl font-bold text-[var(--text-primary)] mb-3">
        Welcome to Traceform!
      </h2>
      <p className="text-[var(--text-secondary)] max-w-md mx-auto leading-relaxed">
        {"Let's get your AI agents monitored in 2 minutes. We'll generate an API key, install the SDK, and verify your first event."}
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-sm text-[var(--text-tertiary)]">
        {["Observability", "Self-Healing", "Testing", "Guardrails", "Gateway", "Cost"].map((mod) => (
          <span key={mod} className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--bg-hover)]">
            <Check className="w-3 h-3 text-[var(--accent-green)]" />
            {mod}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 2: Create API Key                                             */
/* ------------------------------------------------------------------ */

function ApiKeyStep({
  apiKey,
  onGenerate,
  isGenerating,
}: {
  apiKey: string | null;
  onGenerate: () => void;
  isGenerating: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(true);

  const handleCopy = useCallback(() => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [apiKey]);

  return (
    <div className="py-6">
      <div className="text-center mb-8">
        <div className="w-12 h-12 rounded-xl bg-[var(--accent-purple)]/10 flex items-center justify-center mx-auto mb-4">
          <Key className="w-6 h-6 text-[var(--accent-purple)]" />
        </div>
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">
          Create Your API Key
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          {"You'll need this to authenticate your SDK. Save it — you won't see it again."}
        </p>
      </div>

      {!apiKey ? (
        <div className="flex justify-center">
          <button
            onClick={onGenerate}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-[var(--accent-blue)] text-white font-medium hover:bg-[var(--accent-blue)]/90 transition-colors disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Key className="w-4 h-4" />
                Generate API Key
              </>
            )}
          </button>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                Your API Key
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-[var(--accent-green)]" />
                      <span className="text-[var(--accent-green)]">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>
            </div>
            <div className="font-mono text-sm text-[var(--text-primary)] bg-[var(--bg-hover)] rounded-lg px-4 py-3 break-all">
              {showKey ? apiKey : apiKey.replace(/(?<=tf_sk_.{4}).+/, (m) => "*".repeat(m.length))}
            </div>
          </div>

          <div className="mt-4 flex items-start gap-2.5 px-1">
            <div className="w-5 h-5 rounded-full bg-[var(--accent-amber)]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-[var(--accent-amber)] text-xs font-bold">!</span>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              Save this key somewhere safe. For security, we only show the full key once. You can always create a new key in Settings.
            </p>
          </div>
        </motion.div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 3: Install SDK                                                */
/* ------------------------------------------------------------------ */

function InstallStep({ apiKey }: { apiKey: string }) {
  const [activeTab, setActiveTab] = useState<"python" | "typescript">("python");

  const pythonInstall = `pip install traceform`;
  const typescriptInstall = `npm install traceform`;

  const pythonUsage = `import traceform

traceform.init(
    api_key="${apiKey}",
    shield=True,
)

@traceform.trace(healing=True)
def my_agent(query):
    return llm.chat(query)

# Call your agent — Traceform handles the rest
result = my_agent("What is the weather today?")`;

  const typescriptUsage = `import { Traceform } from 'traceform';

const tf = new Traceform({
  apiKey: '${apiKey}',
  shield: true,
});

const myAgent = tf.trace(async (query: string) => {
  return await llm.chat(query);
}, { healing: true });

// Call your agent — Traceform handles the rest
const result = await myAgent("What is the weather today?");`;

  return (
    <div className="py-6">
      <div className="text-center mb-8">
        <div className="w-12 h-12 rounded-xl bg-[var(--healing-blue)]/10 flex items-center justify-center mx-auto mb-4">
          <Terminal className="w-6 h-6 text-[var(--healing-blue)]" />
        </div>
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">
          Install the SDK
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Add Traceform to your project with one command.
        </p>
      </div>

      {/* Language tabs */}
      <div className="flex items-center gap-1 p-1 bg-[var(--bg-hover)] rounded-lg w-fit mx-auto mb-6">
        {(["python", "typescript"] as const).map((lang) => (
          <button
            key={lang}
            onClick={() => setActiveTab(lang)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === lang
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {lang === "python" ? "Python" : "TypeScript"}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <CodeSnippet
          language={activeTab === "python" ? "Bash" : "Bash"}
          code={activeTab === "python" ? pythonInstall : typescriptInstall}
        />
        <CodeSnippet
          language={activeTab === "python" ? "Python" : "TypeScript"}
          code={activeTab === "python" ? pythonUsage : typescriptUsage}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 4: Send first event                                           */
/* ------------------------------------------------------------------ */

function VerifyStep({
  eventReceived,
  isPolling,
}: {
  eventReceived: boolean;
  isPolling: boolean;
}) {
  return (
    <div className="py-6">
      <div className="text-center mb-8">
        <div className="w-12 h-12 rounded-xl bg-[var(--accent-green)]/10 flex items-center justify-center mx-auto mb-4">
          <Radio className="w-6 h-6 text-[var(--accent-green)]" />
        </div>
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">
          Send Your First Event
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Run your agent with the SDK installed. We are listening for your first event.
        </p>
      </div>

      <div className="flex flex-col items-center">
        {!eventReceived ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center"
          >
            <div className="relative w-20 h-20 mx-auto mb-6">
              {/* Pulsing rings */}
              <div className="absolute inset-0 rounded-full border-2 border-[var(--accent-blue)]/20 animate-ping" />
              <div
                className="absolute inset-2 rounded-full border-2 border-[var(--accent-blue)]/30 animate-ping"
                style={{ animationDelay: "0.3s" }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-10 h-10 rounded-full bg-[var(--accent-blue)]/10 flex items-center justify-center">
                  {isPolling ? (
                    <Loader2 className="w-5 h-5 text-[var(--accent-blue)] animate-spin" />
                  ) : (
                    <Radio className="w-5 h-5 text-[var(--accent-blue)]" />
                  )}
                </div>
              </div>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-2">
              Waiting for first event...
            </p>
            <p className="text-xs text-[var(--text-tertiary)]">
              Run your agent with the Traceform SDK, and we will detect it automatically.
            </p>
          </motion.div>
        ) : (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", bounce: 0.4, duration: 0.6 }}
            className="text-center"
          >
            <div className="w-20 h-20 rounded-full bg-[var(--accent-green)]/10 flex items-center justify-center mx-auto mb-6">
              <Check className="w-10 h-10 text-[var(--accent-green)]" />
            </div>
            <p className="text-lg font-semibold text-[var(--text-primary)] mb-2">
              Event received!
            </p>
            <p className="text-sm text-[var(--text-secondary)]">
              Your agent is now being monitored by Traceform.
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 5: Done                                                       */
/* ------------------------------------------------------------------ */

function DoneStep() {
  return (
    <div className="text-center py-8">
      <div className="w-16 h-16 rounded-2xl bg-[var(--accent-green)]/10 flex items-center justify-center mx-auto mb-6">
        <PartyPopper className="w-8 h-8 text-[var(--accent-green)]" />
      </div>
      <h2 className="text-2xl md:text-3xl font-bold text-[var(--text-primary)] mb-3">
        {"You're all set!"}
      </h2>
      <p className="text-[var(--text-secondary)] max-w-md mx-auto leading-relaxed mb-8">
        Your agents are now being monitored. Head to the dashboard to see sessions, traces, and healing events in real time.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg mx-auto mb-8">
        {[
          { label: "Sessions", desc: "View agent runs" },
          { label: "Self-Healing", desc: "Auto-fix issues" },
          { label: "Analytics", desc: "Track performance" },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3 text-center"
          >
            <p className="text-sm font-medium text-[var(--text-primary)]">{item.label}</p>
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function OnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [direction, setDirection] = useState(1);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [eventReceived, setEventReceived] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Generate API key
  const handleGenerateKey = useCallback(async () => {
    setIsGenerating(true);
    try {
      // Try to call the API to generate a key
      const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(`${API_URL}/v1/api-keys`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Onboarding Key", scopes: ["ingest", "query"] }),
      });

      if (res.ok) {
        const data = await res.json();
        setApiKey(data.key || data.api_key || data.raw_key);
      } else {
        // Fallback: generate a demo key for onboarding flow
        const demoKey = `tf_sk_${Array.from({ length: 32 }, () =>
          "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
        ).join("")}`;
        setApiKey(demoKey);
      }
    } catch {
      // Fallback key if API is unreachable
      const demoKey = `tf_sk_${Array.from({ length: 32 }, () =>
        "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
      ).join("")}`;
      setApiKey(demoKey);
    } finally {
      setIsGenerating(false);
    }
  }, []);

  // Poll for first session on step 4
  useEffect(() => {
    if (currentStep !== 4 || eventReceived) return;

    const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;

    const poll = async () => {
      try {
        const headers: Record<string, string> = {};
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
        if (apiKey) {
          headers["Authorization"] = `Bearer ${apiKey}`;
        }

        const res = await fetch(`${API_URL}/v1/sessions?limit=1`, { headers });
        if (res.ok) {
          const data = await res.json();
          const sessions = data.sessions || data.data || data;
          if (Array.isArray(sessions) && sessions.length > 0) {
            setEventReceived(true);
            setShowConfetti(true);
            setTimeout(() => setShowConfetti(false), 4000);
          }
        }
      } catch {
        // Silently continue polling
      }
    };

    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [currentStep, eventReceived, apiKey]);

  // Navigation
  const goNext = useCallback(() => {
    if (currentStep >= TOTAL_STEPS) return;
    setDirection(1);
    setCurrentStep((s) => s + 1);
  }, [currentStep]);

  const goBack = useCallback(() => {
    if (currentStep <= 1) return;
    setDirection(-1);
    setCurrentStep((s) => s - 1);
  }, [currentStep]);

  const handleFinish = useCallback(() => {
    localStorage.setItem("onboarding_completed", "true");
    router.push("/dashboard/overview");
  }, [router]);

  const handleSkip = useCallback(() => {
    localStorage.setItem("onboarding_completed", "true");
    router.push("/dashboard/overview");
  }, [router]);

  // Can proceed to next step?
  const canProceed = (() => {
    if (currentStep === 2 && !apiKey) return false;
    return true;
  })();

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col">
      {showConfetti && <Confetti />}

      {/* Header */}
      <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]">
        <div className="max-w-2xl mx-auto flex items-center justify-between h-14 px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[var(--accent-blue)] flex items-center justify-center">
              <span className="text-white font-bold text-sm">T</span>
            </div>
            <span className="font-semibold text-sm text-[var(--text-primary)]">Traceform</span>
          </Link>
          <button
            onClick={handleSkip}
            className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          >
            Skip setup
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-start justify-center px-6 pt-10 pb-20">
        <div className="w-full max-w-2xl">
          {/* Step indicator */}
          <div className="mb-10">
            <StepIndicator currentStep={currentStep} totalSteps={TOTAL_STEPS} />
          </div>

          {/* Step card */}
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-6 md:p-8 overflow-hidden">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={currentStep}
                custom={direction}
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
              >
                {currentStep === 1 && <WelcomeStep />}
                {currentStep === 2 && (
                  <ApiKeyStep
                    apiKey={apiKey}
                    onGenerate={handleGenerateKey}
                    isGenerating={isGenerating}
                  />
                )}
                {currentStep === 3 && <InstallStep apiKey={apiKey || "tf_sk_..."} />}
                {currentStep === 4 && (
                  <VerifyStep eventReceived={eventReceived} isPolling={!eventReceived} />
                )}
                {currentStep === 5 && <DoneStep />}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-6">
            <div>
              {currentStep > 1 && currentStep < TOTAL_STEPS && (
                <button
                  onClick={goBack}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {currentStep === 4 && !eventReceived && (
                <button
                  onClick={goNext}
                  className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                >
                  Skip this step
                </button>
              )}
              {currentStep < TOTAL_STEPS ? (
                <button
                  onClick={goNext}
                  disabled={!canProceed}
                  className="inline-flex items-center gap-2 h-10 px-6 rounded-lg bg-[var(--accent-blue)] text-white text-sm font-medium hover:bg-[var(--accent-blue)]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {currentStep === 4 && eventReceived ? "Continue" : "Next"}
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={handleFinish}
                  className="inline-flex items-center gap-2 h-10 px-6 rounded-lg bg-[var(--accent-green)] text-white text-sm font-medium hover:bg-[var(--accent-green)]/90 transition-colors"
                >
                  Go to Dashboard
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
