"use client";

import { motion, useInView, AnimatePresence, type Variants } from "framer-motion";
import { useRef, useState, useCallback } from "react";
import Link from "next/link";
import {
  Shield,
  Activity,
  FlaskConical,
  ShieldCheck,
  Route,
  DollarSign,
  Check,
  Minus,
  ArrowRight,
  Github,
  Zap,
  Lock,
  Globe,
  AlertTriangle,
  Layers,
  Wrench,
  Users,
  FileText,
  KeyRound,
  Terminal,
  Copy,
  ExternalLink,
  Star,
  Sparkles,
  ChevronRight,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Animation helpers                                                  */
/* ------------------------------------------------------------------ */

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};

const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const fadeUpItem: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: "easeOut" } },
};

const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: "easeOut" } },
};

const slideIn: Variants = {
  hidden: { opacity: 0, x: -16 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};

/* ------------------------------------------------------------------ */
/*  Section wrapper with whileInView                                   */
/* ------------------------------------------------------------------ */

function Section({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.section
      ref={ref}
      id={id}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      variants={stagger}
      className={className}
    >
      {children}
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const modules = [
  {
    icon: Shield,
    title: "Self-Healing",
    tag: "Shield",
    unique: true,
    description: "Auto-fixes loops, hallucinations, cost overruns, and timeouts before they impact users.",
    features: [
      "Thread-safe healing engine",
      "Bounded retries with backoff",
      "Cost circuit breaker",
    ],
    color: "#38bdf8",
  },
  {
    icon: Activity,
    title: "Observability",
    tag: "Trace",
    unique: false,
    description: "Split-pane session explorer with infinite scroll, keyboard nav, and D3 Gantt timeline.",
    features: [
      "Real-time session replay",
      "Virtual scrolling at scale",
      "Failure pattern detection",
    ],
    color: "#3b82f6",
  },
  {
    icon: FlaskConical,
    title: "Evaluation",
    tag: "Test",
    unique: false,
    description: "CI/CD quality gates with 15+ evaluators. Run from CLI or dashboard.",
    features: [
      "traceform test run --ci --format junit",
      "LLM-judge + programmatic evaluators",
      "Auto-regression from prod sessions",
    ],
    color: "#a855f7",
  },
  {
    icon: ShieldCheck,
    title: "Guardrails",
    tag: "Guard",
    unique: false,
    description: "PII detection, prompt injection prevention, toxicity filter. Parallel execution.",
    features: [
      "Regex-based PII (fast path)",
      "LLM-judge for toxicity/hallucination",
      "Custom policy guards",
    ],
    color: "#22c55e",
  },
  {
    icon: Route,
    title: "Gateway",
    tag: "Route",
    unique: false,
    description: "LLM gateway with circuit breakers, singleflight caching, and provider failover.",
    features: [
      "<5ms overhead",
      "OpenAI-compatible endpoint",
      "6 provider adapters",
    ],
    color: "#f59e0b",
  },
  {
    icon: DollarSign,
    title: "Cost Intelligence",
    tag: "Cost",
    unique: false,
    description: "Budget enforcement, model comparison, per-outcome cost tracking, and data export.",
    features: [
      "Real-time spend dashboards",
      "Budget alerts & enforcement",
      "What-if model comparison",
    ],
    color: "#ef4444",
  },
];

const painPoints = [
  {
    icon: AlertTriangle,
    title: "Agents fail silently",
    description: "Loops, hallucinations, cost overruns, and timeouts go undetected until a customer complains.",
  },
  {
    icon: Layers,
    title: "5+ tools to manage",
    description: "Langfuse for traces, DeepEval for tests, Portkey for routing, Guardrails AI for safety, custom code for cost...",
  },
  {
    icon: Wrench,
    title: "No self-healing",
    description: "When agents break in production, someone has to manually diagnose, fix, and redeploy. Every time.",
  },
];

const enterpriseFeatures = [
  {
    icon: KeyRound,
    title: "SSO (SAML/OIDC)",
    description: "Connect your identity provider. Okta, Azure AD, Google Workspace, and any SAML 2.0 IdP.",
  },
  {
    icon: Users,
    title: "RBAC",
    description: "Owner, Admin, Viewer roles on every endpoint. Scoped to projects and environments.",
  },
  {
    icon: FileText,
    title: "Audit Logging",
    description: "Track every action across your organization. Structured, searchable, exportable.",
  },
  {
    icon: Lock,
    title: "Compliance",
    description: "SOC 2 ready, GDPR deletion API, encrypted at rest. Deploy on-prem for full data control.",
  },
];

const comparisonFeatures = [
  "Self-Healing",
  "Tracing",
  "Testing",
  "Guardrails",
  "Gateway",
  "Cost Intelligence",
  "Open Source",
  "CI/CD CLI",
];

type Support = "full" | "partial" | "none";

const competitors: { name: string; support: Support[] }[] = [
  { name: "Traceform", support: ["full", "full", "full", "full", "full", "full", "full", "full"] },
  { name: "Langfuse", support: ["none", "full", "partial", "none", "none", "partial", "full", "none"] },
  { name: "Datadog", support: ["none", "full", "none", "none", "none", "partial", "none", "none"] },
  { name: "Portkey", support: ["none", "partial", "none", "none", "full", "partial", "none", "none"] },
  { name: "Maxime AI", support: ["none", "partial", "full", "partial", "none", "none", "none", "partial"] },
];

const pricingTiers = [
  {
    name: "Self-Hosted",
    price: "Free",
    period: "forever",
    description: "Open-source, all features, your infrastructure",
    features: [
      "All 6 modules",
      "10K events/mo",
      "3 team members",
      "7-day retention",
      "Community support",
      "Docker Compose deploy",
    ],
    cta: "Get Started",
    ctaLink: "/login",
    highlighted: false,
  },
  {
    name: "Cloud",
    price: "$49",
    period: "/mo",
    description: "Managed hosting so you can focus on building",
    features: [
      "All 6 modules",
      "100K events/mo",
      "5 team members",
      "30-day retention",
      "Audit log",
      "Data export",
    ],
    cta: "Start Trial",
    ctaLink: "/login",
    highlighted: false,
  },
  {
    name: "Team",
    price: "$199",
    period: "/mo",
    description: "For teams shipping agents at scale",
    features: [
      "All 6 modules",
      "1M events/mo",
      "25 team members",
      "90-day retention",
      "Budget enforcement",
      "Priority support",
    ],
    cta: "Start Trial",
    ctaLink: "/login",
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "Unlimited scale with dedicated support",
    features: [
      "Unlimited events",
      "Unlimited members",
      "SSO / SAML / OIDC",
      "Custom roles",
      "SLA & on-prem deploy",
      "Dedicated support",
    ],
    cta: "Contact Sales",
    ctaLink: "#",
    highlighted: false,
  },
];

/* ------------------------------------------------------------------ */
/*  Comparison cell                                                    */
/* ------------------------------------------------------------------ */

function SupportCell({ support }: { support: Support }) {
  if (support === "full") {
    return (
      <div className="flex items-center justify-center">
        <div className="w-5 h-5 rounded-full bg-[var(--accent-green)]/15 flex items-center justify-center">
          <Check className="w-3 h-3 text-[var(--accent-green)]" />
        </div>
      </div>
    );
  }
  if (support === "partial") {
    return (
      <div className="flex items-center justify-center">
        <div className="w-5 h-5 rounded-full bg-[var(--accent-amber)]/15 flex items-center justify-center">
          <Minus className="w-3 h-3 text-[var(--accent-amber)]" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center">
      <div className="w-5 h-5 rounded-full bg-[var(--bg-hover)] flex items-center justify-center">
        <Minus className="w-3 h-3 text-[var(--text-tertiary)]" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Code snippet with copy button                                      */
/* ------------------------------------------------------------------ */

function CodeBlock({
  code,
  language,
  className = "",
}: {
  code: string;
  language: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  return (
    <div className={`relative group rounded-xl border border-[var(--border-subtle)] bg-[#0d0d14] overflow-hidden ${className}`}>
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
              <Check className="w-3 h-3" />
              Copied
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
/*  Module tab content                                                 */
/* ------------------------------------------------------------------ */

function ModuleTabContent({ mod }: { mod: typeof modules[number] }) {
  const Icon = mod.icon;
  return (
    <motion.div
      key={mod.tag}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start"
    >
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${mod.color}15` }}
          >
            <Icon className="w-6 h-6" style={{ color: mod.color }} />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h3 className="text-xl font-semibold text-[var(--text-primary)]">
                {mod.title}
              </h3>
              <span
                className="text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full"
                style={{ color: mod.color, backgroundColor: `${mod.color}12` }}
              >
                {mod.tag}
              </span>
              {mod.unique && (
                <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-[var(--accent-amber)]/15 text-[var(--accent-amber)]">
                  Unique
                </span>
              )}
            </div>
          </div>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-6">
          {mod.description}
        </p>
        <ul className="space-y-3">
          {mod.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ backgroundColor: `${mod.color}15` }}
              >
                <Check className="w-3 h-3" style={{ color: mod.color }} />
              </div>
              <span className="text-sm text-[var(--text-secondary)]">{feature}</span>
            </li>
          ))}
        </ul>
      </div>
      {/* Visual placeholder */}
      <div
        className="relative rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-1 overflow-hidden"
        style={{ minHeight: 240 }}
      >
        <div className="absolute inset-0 opacity-60" style={{
          background: `radial-gradient(ellipse at 30% 20%, ${mod.color}08, transparent 60%), radial-gradient(ellipse at 80% 70%, ${mod.color}05, transparent 50%)`,
        }} />
        {/* Faux UI skeleton */}
        <div className="relative p-5 space-y-3">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: mod.color }} />
            <div className="h-3 w-24 rounded bg-[var(--bg-hover)]" />
            <div className="ml-auto h-3 w-16 rounded bg-[var(--bg-hover)]" />
          </div>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[var(--bg-hover)]" />
              <div className="flex-1 space-y-1.5">
                <div className="h-2.5 rounded bg-[var(--bg-hover)]" style={{ width: `${70 - i * 10}%` }} />
                <div className="h-2 rounded bg-[var(--bg-hover)]" style={{ width: `${50 - i * 5}%` }} />
              </div>
              <div className="w-14 h-6 rounded-md bg-[var(--bg-hover)]" />
            </div>
          ))}
          {/* Gantt-like bars for Trace */}
          <div className="mt-4 space-y-1.5">
            {[1, 2, 3].map((i) => (
              <div key={`bar-${i}`} className="flex items-center gap-2">
                <div className="h-2 rounded-full" style={{
                  width: `${30 + i * 15}%`,
                  backgroundColor: `${mod.color}30`,
                }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Product mockup for hero                                            */
/* ------------------------------------------------------------------ */

function ProductMockup() {
  return (
    <div className="relative rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-2xl shadow-black/30 overflow-hidden">
      {/* Title bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-[#ef4444]/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#eab308]/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#22c55e]/60" />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[var(--bg-hover)] text-[10px] text-[var(--text-tertiary)]">
            <Lock className="w-2.5 h-2.5" />
            app.traceform.dev/sessions
          </div>
        </div>
      </div>
      {/* Split pane mockup */}
      <div className="grid grid-cols-5 min-h-[280px] md:min-h-[340px]">
        {/* Sidebar sessions list */}
        <div className="col-span-2 border-r border-[var(--border-subtle)] p-3 space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-3 w-16 rounded bg-[var(--bg-hover)]" />
            <div className="ml-auto h-3 w-10 rounded bg-[var(--bg-hover)]" />
          </div>
          {[
            { status: "green", w: "80%" },
            { status: "cyan", w: "65%" },
            { status: "red", w: "72%" },
            { status: "green", w: "55%" },
            { status: "amber", w: "68%" },
            { status: "green", w: "60%" },
          ].map((item, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 p-2 rounded-lg ${i === 1 ? "bg-[var(--bg-hover)]" : ""}`}
            >
              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  item.status === "green" ? "bg-[var(--accent-green)]" :
                  item.status === "cyan" ? "bg-[var(--healing-blue)] status-healed" :
                  item.status === "red" ? "bg-[var(--accent-red)]" :
                  "bg-[var(--accent-amber)]"
                }`}
              />
              <div className="flex-1 space-y-1">
                <div className="h-2 rounded bg-[var(--bg-hover)]" style={{ width: item.w }} />
                <div className="h-1.5 w-12 rounded bg-[var(--bg-hover)]" />
              </div>
            </div>
          ))}
        </div>
        {/* Detail pane */}
        <div className="col-span-3 p-4 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-[var(--healing-blue)] status-healed" />
            <div className="h-3 w-32 rounded bg-[var(--bg-hover)]" />
            <div className="ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--healing-blue)]/10">
              <Shield className="w-2.5 h-2.5 text-[var(--healing-blue)]" />
              <span className="text-[9px] text-[var(--healing-blue)] font-medium">Healed</span>
            </div>
          </div>
          {/* Gantt timeline */}
          <div className="space-y-1.5 mt-4">
            <div className="flex items-center gap-2">
              <span className="text-[8px] text-[var(--text-tertiary)] w-12 text-right">agent</span>
              <div className="h-3 rounded-sm bg-[var(--accent-blue)]/30" style={{ width: "90%", marginLeft: "0%" }} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[8px] text-[var(--text-tertiary)] w-12 text-right">llm.call</span>
              <div className="h-3 rounded-sm bg-[var(--accent-purple)]/30" style={{ width: "40%", marginLeft: "5%" }} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[8px] text-[var(--text-tertiary)] w-12 text-right">tool.run</span>
              <div className="h-3 rounded-sm bg-[var(--accent-green)]/30" style={{ width: "25%", marginLeft: "48%" }} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[8px] text-[var(--text-tertiary)] w-12 text-right">heal</span>
              <div className="h-3 rounded-sm bg-[var(--healing-blue)]/40" style={{ width: "10%", marginLeft: "75%" }} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[8px] text-[var(--text-tertiary)] w-12 text-right">llm.call</span>
              <div className="h-3 rounded-sm bg-[var(--accent-purple)]/30" style={{ width: "15%", marginLeft: "85%" }} />
            </div>
          </div>
          {/* Metrics row */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            {[
              { label: "Latency", value: "1.2s" },
              { label: "Tokens", value: "3,847" },
              { label: "Cost", value: "$0.042" },
            ].map((m) => (
              <div key={m.label} className="rounded-lg bg-[var(--bg-hover)] p-2">
                <div className="text-[8px] text-[var(--text-tertiary)] uppercase tracking-wider">{m.label}</div>
                <div className="text-xs font-semibold text-[var(--text-primary)] mt-0.5">{m.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function LandingPage() {
  const [activeModule, setActiveModule] = useState(0);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] overflow-hidden">
      {/* ============================================================ */}
      {/*  NAV                                                         */}
      {/* ============================================================ */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto flex items-center justify-between h-14 px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[var(--accent-blue)] flex items-center justify-center">
              <span className="text-white font-bold text-sm">T</span>
            </div>
            <span className="font-semibold text-sm text-[var(--text-primary)]">Traceform</span>
          </Link>
          <div className="hidden md:flex items-center gap-8">
            <a href="#why" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
              Why
            </a>
            <a href="#modules" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
              Modules
            </a>
            <a href="#compare" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
              Compare
            </a>
            <a href="#pricing" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
              Pricing
            </a>
            <a
              href="https://docs.traceform.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Docs
            </a>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="hidden sm:inline-flex text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[var(--accent-blue)] text-white text-sm font-medium hover:bg-[var(--accent-blue)]/90 transition-colors"
            >
              Get Started
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </nav>

      {/* ============================================================ */}
      {/*  SECTION 1: HERO                                              */}
      {/* ============================================================ */}
      <div className="relative pt-32 pb-16 md:pt-44 md:pb-24">
        {/* Animated gradient background */}
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                "linear-gradient(var(--text-primary) 1px, transparent 1px), linear-gradient(90deg, var(--text-primary) 1px, transparent 1px)",
              backgroundSize: "64px 64px",
            }}
          />
          <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-[var(--accent-blue)]/[0.06] blur-[150px] pointer-events-none animate-pulse" />
          <div className="absolute top-40 left-1/4 w-[500px] h-[500px] rounded-full bg-[var(--accent-purple)]/[0.04] blur-[120px] pointer-events-none" />
          <div className="absolute top-60 right-1/4 w-[400px] h-[400px] rounded-full bg-[var(--healing-blue)]/[0.03] blur-[100px] pointer-events-none" />
        </div>

        <div className="relative max-w-5xl mx-auto px-6 text-center">
          {/* Badges */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex flex-wrap items-center justify-center gap-3 mb-8"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] text-xs text-[var(--text-secondary)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-pulse" />
              Open Source
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] text-xs text-[var(--text-secondary)]">
              <Globe className="w-3 h-3" />
              traceform.dev
            </div>
            <a
              href="https://github.com/traceform/traceform"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Github className="w-3 h-3" />
              <Star className="w-3 h-3" />
              Star us
            </a>
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight text-[var(--text-primary)] leading-[1.08]"
          >
            The self-healing platform
            <br />
            <span className="bg-gradient-to-r from-[var(--accent-blue)] via-[var(--accent-purple)] to-[var(--healing-blue)] bg-clip-text text-transparent">
              for AI agents
            </span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35 }}
            className="mt-6 text-lg md:text-xl text-[var(--text-secondary)] max-w-2xl mx-auto leading-relaxed"
          >
            Open-source observability, self-healing, testing, guardrails, routing, and cost intelligence — in one platform.
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link
              href="/login"
              className="inline-flex items-center gap-2 h-12 px-7 rounded-xl bg-[var(--accent-blue)] text-white font-medium hover:bg-[var(--accent-blue)]/90 transition-all hover:shadow-lg hover:shadow-[var(--accent-blue)]/20 active:scale-[0.98]"
            >
              Get Started Free
              <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="https://github.com/traceform/traceform"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 h-12 px-7 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-primary)] font-medium hover:bg-[var(--bg-hover)] transition-colors active:scale-[0.98]"
            >
              <Github className="w-4 h-4" />
              View on GitHub
            </a>
          </motion.div>

          {/* Product mockup */}
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.7 }}
            className="mt-16 md:mt-20 max-w-4xl mx-auto"
          >
            <ProductMockup />
          </motion.div>
        </div>
      </div>

      {/* ============================================================ */}
      {/*  SECTION 2: WHY TRACEFORM?                                   */}
      {/* ============================================================ */}
      <Section id="why" className="max-w-5xl mx-auto px-6 py-20 md:py-28">
        <motion.div variants={fadeUp} className="text-center mb-14">
          <p className="text-xs uppercase tracking-widest text-[var(--accent-red)] font-medium mb-3">
            The Problem
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)]">
            Your AI agents are running in production.
            <br className="hidden md:block" />
            <span className="text-[var(--text-secondary)]"> But are they reliable?</span>
          </h2>
        </motion.div>

        <motion.div variants={stagger} className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {painPoints.map((point) => {
            const Icon = point.icon;
            return (
              <motion.div
                key={point.title}
                variants={fadeUpItem}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-6"
              >
                <div className="w-10 h-10 rounded-lg bg-[var(--accent-red)]/10 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-[var(--accent-red)]" />
                </div>
                <h3 className="text-base font-semibold text-[var(--text-primary)] mb-2">
                  {point.title}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  {point.description}
                </p>
              </motion.div>
            );
          })}
        </motion.div>

        <motion.div variants={fadeUp} className="mt-12 text-center">
          <p className="text-lg text-[var(--text-primary)] font-medium">
            Traceform replaces all of them with one platform.{" "}
            <span className="bg-gradient-to-r from-[var(--healing-blue)] to-[var(--accent-blue)] bg-clip-text text-transparent font-semibold">
              And adds self-healing.
            </span>
          </p>
        </motion.div>
      </Section>

      {/* ============================================================ */}
      {/*  SECTION 3: THE 6 MODULES (Tabbed)                          */}
      {/* ============================================================ */}
      <Section id="modules" className="max-w-6xl mx-auto px-6 py-20 md:py-28">
        <motion.div variants={fadeUp} className="text-center mb-14">
          <p className="text-xs uppercase tracking-widest text-[var(--accent-blue)] font-medium mb-3">
            Six Modules, One Platform
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)]">
            Everything your agents need
          </h2>
          <p className="mt-4 text-[var(--text-secondary)] max-w-xl mx-auto">
            From first deploy to billion-token scale. Each module works standalone or together.
          </p>
        </motion.div>

        {/* Tab bar */}
        <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-center gap-2 mb-10">
          {modules.map((mod, i) => {
            const Icon = mod.icon;
            const isActive = activeModule === i;
            return (
              <button
                key={mod.tag}
                onClick={() => setActiveModule(i)}
                className={`relative flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? "text-[var(--text-primary)] bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-sm"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                <Icon className="w-4 h-4" style={{ color: isActive ? mod.color : undefined }} />
                {mod.tag}
                {mod.unique && (
                  <Sparkles className="w-3 h-3 text-[var(--accent-amber)]" />
                )}
              </button>
            );
          })}
        </motion.div>

        {/* Tab content */}
        <motion.div variants={fadeUp}>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-6 md:p-10">
            <AnimatePresence mode="wait">
              <ModuleTabContent mod={modules[activeModule]} />
            </AnimatePresence>
          </div>
        </motion.div>
      </Section>

      {/* ============================================================ */}
      {/*  SECTION 4: ENTERPRISE FEATURES                              */}
      {/* ============================================================ */}
      <Section id="enterprise" className="max-w-5xl mx-auto px-6 py-20 md:py-28">
        <motion.div variants={fadeUp} className="text-center mb-14">
          <p className="text-xs uppercase tracking-widest text-[var(--accent-green)] font-medium mb-3">
            Enterprise Ready
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)]">
            Enterprise-ready from day one
          </h2>
          <p className="mt-4 text-[var(--text-secondary)] max-w-xl mx-auto">
            Security, compliance, and access control built in — not bolted on.
          </p>
        </motion.div>

        <motion.div variants={stagger} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {enterpriseFeatures.map((feature) => {
            const Icon = feature.icon;
            return (
              <motion.div
                key={feature.title}
                variants={fadeUpItem}
                className="group relative rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-6 hover:border-[var(--border-default)] transition-all"
              >
                <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-gradient-to-br from-[var(--accent-green)]/[0.02] to-transparent" />
                <div className="relative flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-[var(--accent-green)]/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-[var(--accent-green)]" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">
                      {feature.title}
                    </h3>
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </Section>

      {/* ============================================================ */}
      {/*  SECTION 5: COMPARISON TABLE                                 */}
      {/* ============================================================ */}
      <Section id="compare" className="max-w-5xl mx-auto px-6 py-20 md:py-28">
        <motion.div variants={fadeUp} className="text-center mb-14">
          <p className="text-xs uppercase tracking-widest text-[var(--accent-purple)] font-medium mb-3">
            Replace Your Stack
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)]">
            Replace 5 tools with one
          </h2>
          <p className="mt-4 text-[var(--text-secondary)] max-w-xl mx-auto">
            Traceform is the only platform that covers observability, self-healing, testing, guardrails, gateway, and cost tracking.
          </p>
        </motion.div>

        <motion.div
          variants={scaleIn}
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="text-left px-5 py-4 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                    Feature
                  </th>
                  {competitors.map((c) => (
                    <th
                      key={c.name}
                      className={`px-4 py-4 text-[10px] uppercase tracking-wider font-medium text-center ${
                        c.name === "Traceform"
                          ? "text-[var(--accent-blue)]"
                          : "text-[var(--text-tertiary)]"
                      }`}
                    >
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisonFeatures.map((feature, fi) => (
                  <tr
                    key={feature}
                    className="border-b border-[var(--border-subtle)] last:border-0"
                  >
                    <td className="px-5 py-3.5 text-sm text-[var(--text-primary)]">
                      {feature}
                    </td>
                    {competitors.map((c) => (
                      <td key={c.name} className="px-4 py-3.5">
                        <SupportCell support={c.support[fi]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      </Section>

      {/* ============================================================ */}
      {/*  SECTION 6: DEVELOPER EXPERIENCE                             */}
      {/* ============================================================ */}
      <Section id="developer" className="max-w-5xl mx-auto px-6 py-20 md:py-28">
        <motion.div variants={fadeUp} className="text-center mb-14">
          <p className="text-xs uppercase tracking-widest text-[var(--healing-blue)] font-medium mb-3">
            Developer Experience
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)]">
            One import. Self-healing enabled.
          </h2>
          <p className="mt-4 text-[var(--text-secondary)] max-w-xl mx-auto">
            Production-ready in under 5 minutes. No complex configuration required.
          </p>
        </motion.div>

        <motion.div variants={stagger} className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <motion.div variants={fadeUpItem}>
            <CodeBlock
              language="Python"
              code={`import traceform

traceform.init(api_key="tf_sk_...", shield=True)

@traceform.trace(healing=True)
def my_agent(query):
    return llm.chat(query)

# That's it. Self-healing enabled.
# Loops, hallucinations, cost overruns
# are auto-fixed before they impact users.`}
            />
          </motion.div>

          <motion.div variants={fadeUpItem} className="space-y-6">
            <CodeBlock
              language="CLI"
              code={`# Run tests in CI/CD
$ traceform test run --ci --threshold 95

Running suite: production-quality-gate
  ✓ relevance       0.94
  ✓ faithfulness    0.97
  ✓ toxicity        0.01 (below 0.05)
  ✓ cost            $0.03 (below $0.10)

Result: PASS (4/4 evaluators passed)`}
            />
            <div className="flex items-center gap-3 px-4">
              <Terminal className="w-4 h-4 text-[var(--text-tertiary)]" />
              <span className="text-sm text-[var(--text-secondary)]">
                Full CLI for CI/CD pipelines. JUnit XML output supported.
              </span>
            </div>
          </motion.div>
        </motion.div>
      </Section>

      {/* ============================================================ */}
      {/*  SECTION 7: PRICING                                          */}
      {/* ============================================================ */}
      <Section id="pricing" className="max-w-6xl mx-auto px-6 py-20 md:py-28">
        <motion.div variants={fadeUp} className="text-center mb-14">
          <p className="text-xs uppercase tracking-widest text-[var(--accent-green)] font-medium mb-3">
            Pricing
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)]">
            Start free, scale as you grow
          </h2>
          <p className="mt-4 text-[var(--text-secondary)] max-w-xl mx-auto">
            Self-host for free forever, or let us handle the infrastructure.
          </p>
        </motion.div>

        <motion.div
          variants={stagger}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          {pricingTiers.map((tier) => (
            <motion.div
              key={tier.name}
              variants={fadeUpItem}
              className={`relative rounded-xl border p-6 flex flex-col ${
                tier.highlighted
                  ? "border-[var(--accent-blue)] bg-[var(--bg-elevated)] shadow-lg shadow-[var(--accent-blue)]/5"
                  : "border-[var(--border-subtle)] bg-[var(--bg-secondary)]"
              }`}
            >
              {tier.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-[var(--accent-blue)] text-white text-[10px] font-semibold uppercase tracking-wider">
                  Most Popular
                </div>
              )}
              <div className="mb-4">
                <h3 className="text-sm font-medium text-[var(--text-secondary)]">
                  {tier.name}
                </h3>
                <div className="flex items-baseline gap-1 mt-2">
                  <span className="text-3xl font-bold text-[var(--text-primary)]">
                    {tier.price}
                  </span>
                  {tier.period && (
                    <span className="text-sm text-[var(--text-tertiary)]">
                      {tier.period}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-tertiary)] mt-2">
                  {tier.description}
                </p>
              </div>
              <ul className="space-y-2.5 mb-6 flex-1">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                    <Check className="w-3.5 h-3.5 text-[var(--accent-green)] flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={tier.ctaLink}
                className={`inline-flex items-center justify-center h-10 rounded-lg text-sm font-medium transition-colors active:scale-[0.98] ${
                  tier.highlighted
                    ? "bg-[var(--accent-blue)] text-white hover:bg-[var(--accent-blue)]/90"
                    : "border border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                {tier.cta}
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* ============================================================ */}
      {/*  FINAL CTA                                                   */}
      {/* ============================================================ */}
      <Section className="max-w-4xl mx-auto px-6 py-20 md:py-28">
        <motion.div
          variants={fadeUp}
          className="relative rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-10 md:p-16 text-center overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-[var(--accent-blue)]/[0.04] via-transparent to-[var(--accent-purple)]/[0.04] pointer-events-none" />
          <div className="relative">
            <h2 className="text-2xl md:text-3xl font-bold text-[var(--text-primary)]">
              Ready to ship agents with confidence?
            </h2>
            <p className="mt-4 text-[var(--text-secondary)] max-w-lg mx-auto">
              Join the teams using Traceform to monitor, heal, test, and optimize their AI agents in production.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 h-12 px-7 rounded-xl bg-[var(--accent-blue)] text-white font-medium hover:bg-[var(--accent-blue)]/90 transition-all hover:shadow-lg hover:shadow-[var(--accent-blue)]/20 active:scale-[0.98]"
              >
                Get Started Free
                <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="https://github.com/traceform/traceform"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 h-12 px-7 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-primary)] font-medium hover:bg-[var(--bg-hover)] transition-colors active:scale-[0.98]"
              >
                <Github className="w-4 h-4" />
                Star on GitHub
              </a>
            </div>
          </div>
        </motion.div>
      </Section>

      {/* ============================================================ */}
      {/*  SECTION 8: FOOTER                                           */}
      {/* ============================================================ */}
      <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-primary)]">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
            <div>
              <h4 className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-4">
                Product
              </h4>
              <ul className="space-y-2.5">
                {["Self-Healing", "Observability", "Evaluation", "Guardrails", "Gateway", "Cost Intelligence"].map(
                  (item) => (
                    <li key={item}>
                      <a href="#modules" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                        {item}
                      </a>
                    </li>
                  )
                )}
              </ul>
            </div>
            <div>
              <h4 className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-4">
                Developers
              </h4>
              <ul className="space-y-2.5">
                {[
                  { label: "Docs", href: "https://docs.traceform.dev" },
                  { label: "API Reference", href: "https://docs.traceform.dev/api" },
                  { label: "GitHub", href: "https://github.com/traceform/traceform" },
                  { label: "Status", href: "https://status.traceform.dev" },
                ].map((item) => (
                  <li key={item.label}>
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors inline-flex items-center gap-1"
                    >
                      {item.label}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-4">
                Company
              </h4>
              <ul className="space-y-2.5">
                {["About", "Blog", "Careers", "Contact"].map((item) => (
                  <li key={item}>
                    <a href="#" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-4">
                Legal
              </h4>
              <ul className="space-y-2.5">
                {["Privacy Policy", "Terms of Service", "Security", "License (Apache 2.0)"].map(
                  (item) => (
                    <li key={item}>
                      <a href="#" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                        {item}
                      </a>
                    </li>
                  )
                )}
              </ul>
            </div>
          </div>
          <div className="flex flex-col md:flex-row items-center justify-between pt-8 border-t border-[var(--border-subtle)]">
            <div className="flex items-center gap-4 mb-4 md:mb-0">
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-md bg-[var(--accent-blue)] flex items-center justify-center">
                  <span className="text-white font-bold text-[10px]">T</span>
                </div>
                <span className="text-sm text-[var(--text-tertiary)]">
                  Traceform &copy; {new Date().getFullYear()}
                </span>
              </div>
              <span className="text-xs text-[var(--text-tertiary)] hidden md:inline">
                Built with Go, Next.js, ClickHouse, and love
              </span>
            </div>
            <div className="flex items-center gap-6">
              <a
                href="https://github.com/traceform/traceform"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Github className="w-4 h-4" />
              </a>
              <a href="#" className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
              </a>
              <a href="#" className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026 13.83 13.83 0 0 0 1.226-1.963.074.074 0 0 0-.041-.104 13.175 13.175 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.245.195.372.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028z" /></svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
