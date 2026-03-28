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
  Monitor,
  Cloud,
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

const selfHostedTiers = [
  {
    name: "Community",
    subtitle: "Free forever \u2014 your infrastructure",
    price: "Free",
    period: "forever",
    description: "All 6 modules on your own servers. Deploy with Docker Compose and get started in minutes.",
    features: [
      "All 6 modules",
      "3 team members",
      "7-day retention",
      "Basic RBAC (admin/viewer)",
      "Docker Compose deploy",
      "Community support (GitHub)",
    ],
    cta: "Get Started",
    ctaLink: "/login",
    highlighted: false,
  },
  {
    name: "Team",
    subtitle: "License key \u2014 your infrastructure",
    price: "$199",
    period: "/mo",
    description: "Everything in Community, plus team features, extended retention, and priority support.",
    features: [
      "25 team members",
      "90-day retention",
      "Audit logging",
      "Data export (CSV/JSON)",
      "Error groups",
      "Budget enforcement",
      "Email support",
    ],
    cta: "Start Free Trial",
    ctaLink: "/login",
    highlighted: true,
  },
  {
    name: "Enterprise",
    subtitle: "Custom license \u2014 your infrastructure",
    price: "Custom",
    period: "",
    description: "Unlimited scale with SSO, custom roles, SLA, and on-prem deployment assistance.",
    features: [
      "Unlimited members",
      "Custom retention",
      "SSO (SAML/OIDC)",
      "Custom roles",
      "SLA guarantee",
      "Dedicated support",
      "On-prem deployment assistance",
    ],
    cta: "Contact Sales",
    ctaLink: "#",
    highlighted: false,
  },
];

const cloudTiers = [
  {
    name: "Starter",
    subtitle: "Fully managed \u2014 we run it",
    price: "$49",
    period: "/mo",
    description: "All 6 modules fully managed. Zero infrastructure, automatic updates, start in 30 seconds.",
    features: [
      "All 6 modules",
      "3 team members",
      "30-day retention",
      "Basic RBAC (admin/viewer)",
      "Automatic updates & backups",
      "Zero infrastructure",
      "Email support",
    ],
    cta: "Try Cloud",
    ctaLink: "/login",
    highlighted: false,
  },
  {
    name: "Pro",
    subtitle: "Fully managed \u2014 team features",
    price: "$199",
    period: "/mo",
    description: "Team features fully managed. Audit logs, exports, error groups, and 99.9% uptime.",
    features: [
      "25 team members",
      "90-day retention",
      "Audit logging",
      "Data export (CSV/JSON)",
      "Error groups",
      "Budget enforcement",
      "Priority support",
      "99.9% uptime SLA",
    ],
    cta: "Try Cloud",
    ctaLink: "/login",
    highlighted: true,
  },
  {
    name: "Enterprise",
    subtitle: "Fully managed \u2014 enterprise grade",
    price: "Custom",
    period: "",
    description: "Enterprise-grade managed platform with SSO, SLA guarantee, and SOC 2 compliance.",
    features: [
      "Unlimited members",
      "Custom retention",
      "SSO (SAML/OIDC)",
      "Custom roles",
      "SLA guarantee",
      "Dedicated support",
      "Custom domain",
      "SOC 2 report",
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
        <div className="w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <Check className="w-3 h-3 text-emerald-400" />
        </div>
      </div>
    );
  }
  if (support === "partial") {
    return (
      <div className="flex items-center justify-center">
        <div className="w-5 h-5 rounded-full bg-amber-500/15 flex items-center justify-center">
          <Minus className="w-3 h-3 text-amber-400" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center">
      <div className="w-5 h-5 rounded-full bg-[#1a1a24] flex items-center justify-center">
        <Minus className="w-3 h-3 text-zinc-600" />
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
    <div className={`relative group rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#0d0d14] overflow-hidden ${className}`}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[rgba(255,255,255,0.06)] bg-[#111117]">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
          {language}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-400 transition-colors"
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
        <code className="font-mono text-zinc-400">{code}</code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Module visual previews                                             */
/* ------------------------------------------------------------------ */

function ShieldVisual() {
  return (
    <div className="p-4 space-y-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-3">Healing Timeline</div>
      {/* Session bar transitioning from red to cyan */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-zinc-500 w-20 text-right font-mono">00:00.000</span>
          <div className="flex-1 h-4 rounded-sm overflow-hidden flex">
            <div className="w-[60%] bg-red-500/30 border-r border-[#0d0d14]" />
            <div className="w-[40%] bg-cyan-400/30 relative">
              <div className="absolute inset-y-0 left-0 w-px bg-cyan-400" />
            </div>
          </div>
          <span className="text-[9px] text-zinc-500 w-12 font-mono">7.3s</span>
        </div>
        <div className="flex items-center gap-2 ml-[88px]">
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-400/10 border border-cyan-400/20">
            <Shield className="w-2.5 h-2.5 text-cyan-400" />
            <span className="text-[9px] text-cyan-400 font-medium">Healed</span>
          </div>
          <span className="text-[9px] text-zinc-500">Loop detected at step 3 — model downgraded, retried</span>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-[rgba(255,255,255,0.06)]">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md bg-[#0d0d14] p-2">
            <div className="text-[8px] text-zinc-500 uppercase tracking-wider">Interventions</div>
            <div className="text-sm font-semibold text-white mt-0.5">24</div>
          </div>
          <div className="rounded-md bg-[#0d0d14] p-2">
            <div className="text-[8px] text-zinc-500 uppercase tracking-wider">Saved</div>
            <div className="text-sm font-semibold text-emerald-400 mt-0.5">$12.40</div>
          </div>
          <div className="rounded-md bg-[#0d0d14] p-2">
            <div className="text-[8px] text-zinc-500 uppercase tracking-wider">Success Rate</div>
            <div className="text-sm font-semibold text-cyan-400 mt-0.5">96.2%</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TraceVisual() {
  return (
    <div className="grid grid-cols-5 min-h-[200px]">
      <div className="col-span-2 border-r border-[rgba(255,255,255,0.06)] p-2 space-y-0.5">
        {[
          { name: "Support Agent", status: "green", dur: "2.3s", cost: "$0.12" },
          { name: "Research Agent", status: "blue", dur: "7.3s", cost: "$0.28" },
          { name: "Writing Agent", status: "green", dur: "4.1s", cost: "$0.09" },
          { name: "Code Review", status: "red", dur: "12.1s", cost: "$0.41" },
          { name: "Data Pipeline", status: "green", dur: "780ms", cost: "$0.03" },
        ].map((s, i) => (
          <div key={i} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[10px] ${i === 1 ? "bg-blue-500/10 border-l-2 border-blue-500" : "hover:bg-white/[0.02]"}`}>
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.status === "green" ? "bg-emerald-400" : s.status === "blue" ? "bg-blue-400" : "bg-red-400"}`} />
            <span className="text-zinc-300 truncate flex-1">{s.name}</span>
            <span className="text-zinc-500 font-mono">{s.dur}</span>
          </div>
        ))}
      </div>
      <div className="col-span-3 p-3 space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-white">Research Agent</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-400/10 text-emerald-400 font-medium">Completed</span>
        </div>
        <div className="flex gap-3 text-[9px]">
          <span className="text-zinc-500">Duration <span className="text-zinc-300 font-mono">7.3s</span></span>
          <span className="text-zinc-500">Cost <span className="text-zinc-300 font-mono">$0.28</span></span>
          <span className="text-zinc-500">Tokens <span className="text-zinc-300 font-mono">992</span></span>
          <span className="text-zinc-500">Spans <span className="text-zinc-300 font-mono">5</span></span>
        </div>
        <div className="space-y-1 mt-2 pt-2 border-t border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-1.5">
            <span className="text-[8px] text-zinc-500 w-10 text-right font-mono">llm</span>
            <div className="flex-1 relative h-3">
              <div className="absolute left-[2%] h-full w-[35%] rounded-sm bg-blue-500/40" />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[8px] text-zinc-500 w-10 text-right font-mono">tool</span>
            <div className="flex-1 relative h-3">
              <div className="absolute left-[40%] h-full w-[20%] rounded-sm bg-emerald-500/40" />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[8px] text-zinc-500 w-10 text-right font-mono">llm</span>
            <div className="flex-1 relative h-3">
              <div className="absolute left-[65%] h-full w-[30%] rounded-sm bg-blue-500/40" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TestVisual() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-xs font-medium text-white">production-quality-gate</div>
          <div className="text-[9px] text-zinc-500 mt-0.5">Run #47 &middot; 12s ago</div>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-400/10">
          <Check className="w-3 h-3 text-emerald-400" />
          <span className="text-[10px] text-emerald-400 font-semibold">PASS 4/4</span>
        </div>
      </div>
      <div className="space-y-1.5">
        {[
          { name: "Relevance", score: "0.94", pass: true },
          { name: "Faithfulness", score: "0.97", pass: true },
          { name: "Toxicity", score: "0.01", pass: true },
          { name: "Cost Guard", score: "$0.03", pass: true },
        ].map((ev) => (
          <div key={ev.name} className="flex items-center gap-3 px-3 py-2 rounded-md bg-[#0d0d14]">
            <div className={`w-2 h-2 rounded-full ${ev.pass ? "bg-emerald-400" : "bg-red-400"}`} />
            <span className="text-[11px] text-zinc-300 flex-1">{ev.name}</span>
            <span className="text-[11px] text-zinc-400 font-mono">{ev.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GuardVisual() {
  return (
    <div className="p-4 space-y-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-2">Guard Check</div>
      <div className="rounded-md bg-[#0d0d14] p-3 mb-3">
        <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1.5">Input</div>
        <div className="text-[11px] text-zinc-300 font-mono leading-relaxed">
          &quot;My SSN is 123-45-6789. Can you help me transfer $5000 to account 9876?&quot;
        </div>
      </div>
      <div className="space-y-1.5">
        {[
          { name: "PII Detection", status: "blocked", color: "red" },
          { name: "Prompt Injection", status: "passed", color: "green" },
          { name: "Toxicity Filter", status: "passed", color: "green" },
          { name: "Topic Guard", status: "passed", color: "green" },
        ].map((g) => (
          <div key={g.name} className="flex items-center gap-3 px-3 py-2 rounded-md bg-[#0d0d14]">
            <div className={`w-2 h-2 rounded-full ${g.color === "green" ? "bg-emerald-400" : "bg-red-400"}`} />
            <span className="text-[11px] text-zinc-300 flex-1">{g.name}</span>
            <span className={`text-[10px] font-medium ${g.color === "green" ? "text-emerald-400" : "text-red-400"}`}>
              {g.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RouteVisual() {
  return (
    <div className="p-4 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-3">Providers</div>
      {[
        { name: "OpenAI", model: "gpt-4o", enabled: true, reqs: "12.4K", latency: "340ms" },
        { name: "Anthropic", model: "claude-sonnet-4-20250514", enabled: true, reqs: "8.2K", latency: "280ms" },
        { name: "Google", model: "gemini-2.0-flash", enabled: false, reqs: "—", latency: "—" },
      ].map((p) => (
        <div key={p.name} className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-[#0d0d14]">
          <div className={`w-2 h-2 rounded-full ${p.enabled ? "bg-emerald-400" : "bg-zinc-600"}`} />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-zinc-300 font-medium">{p.name}</div>
            <div className="text-[9px] text-zinc-500 font-mono truncate">{p.model}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-zinc-400 font-mono">{p.reqs}</div>
            <div className="text-[9px] text-zinc-500">{p.latency}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CostVisual() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Cost Breakdown</div>
        <div className="text-[10px] text-zinc-500">Last 7d</div>
      </div>
      {/* Mini stacked area chart */}
      <div className="relative h-24 rounded-md bg-[#0d0d14] p-2 overflow-hidden">
        <svg viewBox="0 0 200 80" className="w-full h-full" preserveAspectRatio="none">
          {/* GPT-4o area */}
          <path d="M0,70 L30,60 L60,55 L90,50 L120,42 L150,38 L180,30 L200,25 L200,80 L0,80 Z" fill="#3b82f6" fillOpacity="0.3" />
          {/* Claude area */}
          <path d="M0,75 L30,68 L60,64 L90,60 L120,55 L150,52 L180,45 L200,40 L200,80 L0,80 Z" fill="#a855f7" fillOpacity="0.2" />
          {/* GPT-4o line */}
          <path d="M0,70 L30,60 L60,55 L90,50 L120,42 L150,38 L180,30 L200,25" fill="none" stroke="#3b82f6" strokeWidth="1.5" />
          {/* Claude line */}
          <path d="M0,75 L30,68 L60,64 L90,60 L120,55 L150,52 L180,45 L200,40" fill="none" stroke="#a855f7" strokeWidth="1.5" />
        </svg>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md bg-[#0d0d14] p-2">
          <div className="text-[8px] text-zinc-500 uppercase tracking-wider">Total</div>
          <div className="text-sm font-semibold text-white mt-0.5">$847</div>
        </div>
        <div className="rounded-md bg-[#0d0d14] p-2">
          <div className="text-[8px] text-zinc-500 uppercase tracking-wider">Avg/Session</div>
          <div className="text-sm font-semibold text-white mt-0.5">$0.14</div>
        </div>
        <div className="rounded-md bg-[#0d0d14] p-2">
          <div className="text-[8px] text-zinc-500 uppercase tracking-wider">Budget</div>
          <div className="text-sm font-semibold text-amber-400 mt-0.5">78%</div>
        </div>
      </div>
      <div className="flex items-center gap-4 text-[9px]">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="text-zinc-500">GPT-4o</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-purple-500" />
          <span className="text-zinc-500">Claude Sonnet</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Module tab content                                                 */
/* ------------------------------------------------------------------ */

function ModuleTabContent({ mod }: { mod: typeof modules[number] }) {
  const Icon = mod.icon;

  const visualMap: Record<string, React.ReactNode> = {
    Shield: <ShieldVisual />,
    Trace: <TraceVisual />,
    Test: <TestVisual />,
    Guard: <GuardVisual />,
    Route: <RouteVisual />,
    Cost: <CostVisual />,
  };

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
              <h3 className="text-xl font-semibold text-white">
                {mod.title}
              </h3>
              <span
                className="text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full"
                style={{ color: mod.color, backgroundColor: `${mod.color}12` }}
              >
                {mod.tag}
              </span>
              {mod.unique && (
                <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
                  Unique
                </span>
              )}
            </div>
          </div>
        </div>
        <p className="text-zinc-400 leading-relaxed mb-6">
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
              <span className="text-sm text-zinc-400">{feature}</span>
            </li>
          ))}
        </ul>
      </div>
      {/* Module-specific visual */}
      <div
        className="relative rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#1a1a24] overflow-hidden"
        style={{ minHeight: 240 }}
      >
        {visualMap[mod.tag]}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Product mockup for hero                                            */
/* ------------------------------------------------------------------ */

function ProductMockup() {
  const sessions = [
    { name: "Customer Support Agent", status: "green" as const, dur: "2.3s", cost: "$0.12", tokens: "1,240" },
    { name: "Research Agent", status: "green" as const, dur: "780ms", cost: "$0.03", tokens: "420" },
    { name: "Writing Agent", status: "blue" as const, dur: "4.1s", cost: "$0.09", tokens: "2,100" },
    { name: "Code Review Agent", status: "red" as const, dur: "12.1s", cost: "$0.41", tokens: "4,800" },
    { name: "Data Pipeline Agent", status: "green" as const, dur: "1.8s", cost: "$0.06", tokens: "890" },
    { name: "QA Validator", status: "green" as const, dur: "3.2s", cost: "$0.11", tokens: "1,680" },
    { name: "Summarization Agent", status: "green" as const, dur: "2.7s", cost: "$0.08", tokens: "1,100" },
  ];

  return (
    <div className="relative rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111117] shadow-2xl shadow-black/40 overflow-hidden">
      {/* Title bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[rgba(255,255,255,0.06)] bg-[#0a0a0f]">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#1a1a24] text-[10px] text-zinc-500">
            <Lock className="w-2.5 h-2.5" />
            app.traceform.dev/sessions
          </div>
        </div>
      </div>
      {/* Split pane mockup */}
      <div className="grid grid-cols-5 min-h-[280px] md:min-h-[340px]">
        {/* Sidebar sessions list */}
        <div className="col-span-2 border-r border-[rgba(255,255,255,0.06)] p-3 space-y-0.5">
          <div className="flex items-center justify-between mb-3 px-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Sessions</span>
            <span className="text-[10px] text-zinc-600">7 total</span>
          </div>
          {sessions.map((s, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 px-2 py-2 rounded-lg cursor-default ${
                i === 2
                  ? "bg-blue-500/10 border-l-2 border-blue-500"
                  : ""
              }`}
            >
              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  s.status === "green" ? "bg-emerald-400" :
                  s.status === "blue" ? "bg-blue-400" :
                  "bg-red-400"
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-zinc-300 truncate">{s.name}</div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-[10px] text-zinc-500 font-mono">{s.dur}</span>
                <span className="text-[10px] text-zinc-600 font-mono">{s.cost}</span>
              </div>
            </div>
          ))}
        </div>
        {/* Detail pane */}
        <div className="col-span-3 p-4 space-y-3">
          {/* Header */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-white">Writing Agent</span>
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-medium">Running</span>
          </div>
          {/* Stats row */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Duration", value: "4.1s" },
              { label: "Cost", value: "$0.09" },
              { label: "Tokens", value: "2,100" },
              { label: "Spans", value: "4" },
            ].map((m) => (
              <div key={m.label} className="rounded-lg bg-[#0d0d14] p-2">
                <div className="text-[8px] text-zinc-500 uppercase tracking-wider">{m.label}</div>
                <div className="text-xs font-semibold text-white mt-0.5">{m.value}</div>
              </div>
            ))}
          </div>
          {/* Gantt timeline */}
          <div className="pt-2">
            <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-2">Timeline</div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[8px] text-zinc-500 w-12 text-right font-mono">agent</span>
                <div className="flex-1 relative h-3.5">
                  <div className="absolute inset-y-0 left-0 right-0 rounded-sm bg-zinc-800/50" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[8px] text-zinc-500 w-12 text-right font-mono">llm.call</span>
                <div className="flex-1 relative h-3.5">
                  <div className="absolute inset-y-0 left-[3%] rounded-sm bg-blue-500/40" style={{ width: "30%" }} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[8px] text-zinc-500 w-12 text-right font-mono">tool.run</span>
                <div className="flex-1 relative h-3.5">
                  <div className="absolute inset-y-0 left-[36%] rounded-sm bg-emerald-500/40" style={{ width: "18%" }} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[8px] text-zinc-500 w-12 text-right font-mono">llm.call</span>
                <div className="flex-1 relative h-3.5">
                  <div className="absolute inset-y-0 left-[58%] rounded-sm bg-blue-500/40" style={{ width: "25%" }} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[8px] text-zinc-500 w-12 text-right font-mono">tool.run</span>
                <div className="flex-1 relative h-3.5">
                  <div className="absolute inset-y-0 left-[86%] rounded-sm bg-emerald-500/40" style={{ width: "12%" }} />
                </div>
              </div>
            </div>
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
  const [pricingTab, setPricingTab] = useState<"self-hosted" | "cloud">("self-hosted");

  return (
    <div className="min-h-screen bg-[#0a0a0f] overflow-hidden">
      {/* ============================================================ */}
      {/*  NAV                                                         */}
      {/* ============================================================ */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0a0a0f]/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-6xl mx-auto flex items-center justify-between h-14 px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">T</span>
            </div>
            <span className="font-semibold text-sm text-white">Traceform</span>
          </Link>
          <div className="hidden md:flex items-center gap-8">
            <a href="#why" className="text-sm text-zinc-400 hover:text-white transition-colors">
              Why
            </a>
            <a href="#modules" className="text-sm text-zinc-400 hover:text-white transition-colors">
              Modules
            </a>
            <a href="#compare" className="text-sm text-zinc-400 hover:text-white transition-colors">
              Compare
            </a>
            <a href="#pricing" className="text-sm text-zinc-400 hover:text-white transition-colors">
              Pricing
            </a>
            <Link
              href="/docs"
              className="text-sm text-zinc-400 hover:text-white transition-colors"
            >
              Docs
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="hidden sm:inline-flex text-sm text-zinc-400 hover:text-white transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 transition-colors"
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
      <div className="relative pt-32 pb-12 md:pt-40 md:pb-16">
        {/* Animated gradient background */}
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                "linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)",
              backgroundSize: "64px 64px",
            }}
          />
          <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-blue-500/[0.06] blur-[150px] pointer-events-none animate-pulse" />
          <div className="absolute top-40 left-1/4 w-[500px] h-[500px] rounded-full bg-purple-500/[0.04] blur-[120px] pointer-events-none" />
          <div className="absolute top-60 right-1/4 w-[400px] h-[400px] rounded-full bg-cyan-400/[0.03] blur-[100px] pointer-events-none" />
        </div>

        <div className="relative max-w-5xl mx-auto px-6 text-center">
          {/* Badges */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex flex-wrap items-center justify-center gap-3 mb-8"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[rgba(255,255,255,0.1)] bg-[#1a1a24] text-xs text-zinc-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Open Source
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[rgba(255,255,255,0.1)] bg-[#1a1a24] text-xs text-zinc-400">
              <Globe className="w-3 h-3" />
              traceform.dev
            </div>
            <a
              href="https://github.com/traceform/traceform"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[rgba(255,255,255,0.1)] bg-[#1a1a24] text-xs text-zinc-400 hover:text-white transition-colors"
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
            className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight text-white leading-[1.08]"
          >
            The self-healing platform
            <br />
            <span className="bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-400 bg-clip-text text-transparent">
              for AI agents
            </span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35 }}
            className="mt-6 text-lg md:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed"
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
              className="inline-flex items-center gap-2 h-12 px-7 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-500 transition-all hover:shadow-lg hover:shadow-blue-600/20 active:scale-[0.98]"
            >
              Get Started Free
              <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="https://github.com/traceform/traceform"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 h-12 px-7 rounded-xl border border-white/10 bg-[#1a1a24] text-white font-medium hover:bg-[#24243e] transition-colors active:scale-[0.98]"
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
            className="mt-14 md:mt-16 max-w-4xl mx-auto"
          >
            <ProductMockup />
          </motion.div>
        </div>
      </div>

      {/* ============================================================ */}
      {/*  SECTION 2: WHY TRACEFORM?                                   */}
      {/* ============================================================ */}
      <Section id="why" className="max-w-5xl mx-auto px-6 py-16 md:py-20">
        <motion.div variants={fadeUp} className="text-center mb-10">
          <p className="text-xs uppercase tracking-widest text-red-400 font-medium mb-3">
            The Problem
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-white">
            Your AI agents are running in production.
            <br className="hidden md:block" />
            <span className="text-zinc-400"> But are they reliable?</span>
          </h2>
        </motion.div>

        <motion.div variants={stagger} className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {painPoints.map((point) => {
            const Icon = point.icon;
            return (
              <motion.div
                key={point.title}
                variants={fadeUpItem}
                className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#1a1a24] p-6"
              >
                <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-red-400" />
                </div>
                <h3 className="text-base font-semibold text-white mb-2">
                  {point.title}
                </h3>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  {point.description}
                </p>
              </motion.div>
            );
          })}
        </motion.div>

        <motion.div variants={fadeUp} className="mt-10 text-center">
          <p className="text-lg text-white font-medium">
            Traceform replaces all of them with one platform.{" "}
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent font-semibold">
              And adds self-healing.
            </span>
          </p>
        </motion.div>
      </Section>

      {/* ============================================================ */}
      {/*  SECTION 3: THE 6 MODULES (Tabbed)                          */}
      {/* ============================================================ */}
      <div className="bg-[#111117]">
        <Section id="modules" className="max-w-6xl mx-auto px-6 py-16 md:py-20">
          <motion.div variants={fadeUp} className="text-center mb-10">
            <p className="text-xs uppercase tracking-widest text-blue-400 font-medium mb-3">
              Six Modules, One Platform
            </p>
            <h2 className="text-3xl md:text-4xl font-bold text-white">
              Everything your agents need
            </h2>
            <p className="mt-3 text-zinc-400 max-w-xl mx-auto">
              From first deploy to billion-token scale. Each module works standalone or together.
            </p>
          </motion.div>

          {/* Tab bar */}
          <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-center gap-2 mb-8">
            {modules.map((mod, i) => {
              const Icon = mod.icon;
              const isActive = activeModule === i;
              return (
                <button
                  key={mod.tag}
                  onClick={() => setActiveModule(i)}
                  className={`relative flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? "text-white bg-[#1a1a24] border border-[rgba(255,255,255,0.1)] shadow-sm"
                      : "text-zinc-400 hover:text-white hover:bg-white/[0.03]"
                  }`}
                >
                  <Icon className="w-4 h-4" style={{ color: isActive ? mod.color : undefined }} />
                  {mod.tag}
                  {mod.unique && (
                    <Sparkles className="w-3 h-3 text-amber-400" />
                  )}
                </button>
              );
            })}
          </motion.div>

          {/* Tab content */}
          <motion.div variants={fadeUp}>
            <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[#0a0a0f] p-6 md:p-10">
              <AnimatePresence mode="wait">
                <ModuleTabContent mod={modules[activeModule]} />
              </AnimatePresence>
            </div>
          </motion.div>
        </Section>
      </div>

      {/* ============================================================ */}
      {/*  SECTION 4: ENTERPRISE FEATURES                              */}
      {/* ============================================================ */}
      <Section id="enterprise" className="max-w-5xl mx-auto px-6 py-16 md:py-20">
        <motion.div variants={fadeUp} className="text-center mb-10">
          <p className="text-xs uppercase tracking-widest text-emerald-400 font-medium mb-3">
            Enterprise Ready
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-white">
            Enterprise-ready from day one
          </h2>
          <p className="mt-3 text-zinc-400 max-w-xl mx-auto">
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
                className="group relative rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#1a1a24] p-6 hover:border-[rgba(255,255,255,0.1)] transition-all"
              >
                <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-gradient-to-br from-emerald-500/[0.02] to-transparent" />
                <div className="relative flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white mb-1">
                      {feature.title}
                    </h3>
                    <p className="text-sm text-zinc-400 leading-relaxed">
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
      <div className="bg-[#111117]">
        <Section id="compare" className="max-w-5xl mx-auto px-6 py-16 md:py-20">
          <motion.div variants={fadeUp} className="text-center mb-10">
            <p className="text-xs uppercase tracking-widest text-purple-400 font-medium mb-3">
              Replace Your Stack
            </p>
            <h2 className="text-3xl md:text-4xl font-bold text-white">
              Replace 5 tools with one
            </h2>
            <p className="mt-3 text-zinc-400 max-w-xl mx-auto">
              Traceform is the only platform that covers observability, self-healing, testing, guardrails, gateway, and cost tracking.
            </p>
          </motion.div>

          <motion.div
            variants={scaleIn}
            className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#0a0a0f] overflow-hidden"
          >
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[rgba(255,255,255,0.06)]">
                    <th className="text-left px-5 py-4 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                      Feature
                    </th>
                    {competitors.map((c) => (
                      <th
                        key={c.name}
                        className={`px-4 py-4 text-[10px] uppercase tracking-wider font-medium text-center ${
                          c.name === "Traceform"
                            ? "text-blue-400"
                            : "text-zinc-500"
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
                      className="border-b border-[rgba(255,255,255,0.06)] last:border-0"
                    >
                      <td className="px-5 py-3.5 text-sm text-white">
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
      </div>

      {/* ============================================================ */}
      {/*  SECTION 6: DEVELOPER EXPERIENCE                             */}
      {/* ============================================================ */}
      <Section id="developer" className="max-w-5xl mx-auto px-6 py-16 md:py-20">
        <motion.div variants={fadeUp} className="text-center mb-10">
          <p className="text-xs uppercase tracking-widest text-cyan-400 font-medium mb-3">
            Developer Experience
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-white">
            One import. Self-healing enabled.
          </h2>
          <p className="mt-3 text-zinc-400 max-w-xl mx-auto">
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
              <Terminal className="w-4 h-4 text-zinc-500" />
              <span className="text-sm text-zinc-400">
                Full CLI for CI/CD pipelines. JUnit XML output supported.
              </span>
            </div>
          </motion.div>
        </motion.div>
      </Section>

      {/* ============================================================ */}
      {/*  SECTION 7: PRICING                                          */}
      {/* ============================================================ */}
      <div className="bg-[#111117]">
        <Section id="pricing" className="max-w-6xl mx-auto px-6 py-16 md:py-20">
          <motion.div variants={fadeUp} className="text-center mb-10">
            <p className="text-xs uppercase tracking-widest text-emerald-400 font-medium mb-3">
              Pricing
            </p>
            <h2 className="text-3xl md:text-4xl font-bold text-white">
              Start free, scale as you grow
            </h2>
            <p className="mt-3 text-zinc-400 max-w-xl mx-auto">
              Self-host for free forever, or let us handle the infrastructure. Licensed under BSL 1.1.
            </p>

            {/* Self-Hosted / Cloud toggle */}
            <div className="mt-6 inline-flex items-center rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#0d0d14] p-1">
              <button
                onClick={() => setPricingTab("self-hosted")}
                className={`relative flex items-center gap-2 px-5 py-2 rounded-md text-sm font-medium transition-all ${
                  pricingTab === "self-hosted"
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                Self-Hosted
              </button>
              <button
                onClick={() => setPricingTab("cloud")}
                className={`relative flex items-center gap-2 px-5 py-2 rounded-md text-sm font-medium transition-all ${
                  pricingTab === "cloud"
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <Cloud className="w-3.5 h-3.5" />
                Cloud Hosted
              </button>
            </div>
          </motion.div>

          <AnimatePresence mode="wait">
            <motion.div
              key={pricingTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              {/* Descriptive banner */}
              {pricingTab === "self-hosted" ? (
                <div className="mb-6 rounded-xl border border-zinc-800 bg-[#13131a] p-4 flex items-start gap-4">
                  <div className="flex-shrink-0 mt-0.5 w-9 h-9 rounded-lg bg-zinc-800/80 flex items-center justify-center">
                    <Monitor className="w-4.5 h-4.5 text-zinc-300" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Self-Hosted</h3>
                    <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                      Deploy on your infrastructure with Docker Compose or Kubernetes.<br className="hidden sm:inline" />{" "}
                      You manage the servers &mdash; we provide the software and license.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mb-6 rounded-xl border border-blue-900/30 bg-[#12122a] p-4 flex items-start gap-4">
                  <div className="flex-shrink-0 mt-0.5 w-9 h-9 rounded-lg bg-blue-900/40 flex items-center justify-center">
                    <Cloud className="w-4.5 h-4.5 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Cloud Hosted</h3>
                    <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                      We handle everything &mdash; deployment, updates, backups, monitoring.<br className="hidden sm:inline" />{" "}
                      No servers to manage. Start in 30 seconds.
                    </p>
                  </div>
                </div>
              )}

              {/* Pricing cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(pricingTab === "self-hosted" ? selfHostedTiers : cloudTiers).map((tier) => {
                  const isCloud = pricingTab === "cloud";
                  return (
                    <div
                      key={tier.name}
                      className={`relative rounded-xl border p-6 flex flex-col ${
                        tier.highlighted
                          ? isCloud
                            ? "border-blue-500 bg-[#1a1a2e] shadow-lg shadow-blue-500/10"
                            : "border-blue-500 bg-[#1a1a24] shadow-lg shadow-blue-500/5"
                          : isCloud
                            ? "border-blue-900/30 bg-[#1a1a2a]"
                            : "border-zinc-800 bg-[#1a1a24]"
                      }`}
                    >
                      {/* Subtle blue gradient overlay for cloud cards */}
                      {isCloud && (
                        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/[0.03] via-transparent to-blue-600/[0.02] pointer-events-none" />
                      )}

                      {tier.highlighted && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-semibold uppercase tracking-wider z-10">
                          Most Popular
                        </div>
                      )}

                      {/* Badge in top-right corner */}
                      <div className="absolute top-4 right-4 z-10">
                        {isCloud ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-900/40 text-[10px] font-medium text-blue-400 border border-blue-800/30">
                            <Cloud className="w-2.5 h-2.5" />
                            Managed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-800/60 text-[10px] font-medium text-zinc-400 border border-zinc-700/30">
                            <Monitor className="w-2.5 h-2.5" />
                            Self-Host
                          </span>
                        )}
                      </div>

                      <div className="relative mb-4">
                        <h3 className="text-sm font-medium text-zinc-400">
                          {tier.name}
                        </h3>
                        <p className="text-[11px] text-zinc-500 mt-0.5">{tier.subtitle}</p>
                        <div className="flex items-baseline gap-1 mt-2">
                          <span className="text-3xl font-bold text-white">
                            {tier.price}
                          </span>
                          {tier.period && (
                            <span className="text-sm text-zinc-500">
                              {tier.period}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-500 mt-2">
                          {tier.description}
                        </p>
                      </div>
                      <ul className="relative space-y-2.5 mb-6 flex-1">
                        {tier.features.map((f) => (
                          <li key={f} className="flex items-center gap-2 text-sm text-zinc-400">
                            <Check className={`w-3.5 h-3.5 flex-shrink-0 ${isCloud ? "text-blue-400" : "text-emerald-400"}`} />
                            {f}
                          </li>
                        ))}
                      </ul>
                      <Link
                        href={tier.ctaLink}
                        className={`relative inline-flex items-center justify-center h-10 rounded-lg text-sm font-medium transition-colors active:scale-[0.98] ${
                          tier.highlighted
                            ? "bg-blue-600 text-white hover:bg-blue-500"
                            : isCloud
                              ? "border border-blue-800/40 text-white hover:bg-blue-900/20"
                              : "border border-white/10 text-white hover:bg-white/5"
                        }`}
                      >
                        {tier.cta}
                      </Link>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </AnimatePresence>
        </Section>
      </div>

      {/* ============================================================ */}
      {/*  FINAL CTA                                                   */}
      {/* ============================================================ */}
      <Section className="max-w-4xl mx-auto px-6 py-16 md:py-20">
        <motion.div
          variants={fadeUp}
          className="relative rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[#111117] p-10 md:p-16 text-center overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/[0.04] via-transparent to-purple-500/[0.04] pointer-events-none" />
          <div className="relative">
            <h2 className="text-2xl md:text-3xl font-bold text-white">
              Ready to ship agents with confidence?
            </h2>
            <p className="mt-4 text-zinc-400 max-w-lg mx-auto">
              Join the teams using Traceform to monitor, heal, test, and optimize their AI agents in production.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 h-12 px-7 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-500 transition-all hover:shadow-lg hover:shadow-blue-600/20 active:scale-[0.98]"
              >
                Get Started Free
                <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="https://github.com/traceform/traceform"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 h-12 px-7 rounded-xl border border-white/10 bg-[#1a1a24] text-white font-medium hover:bg-[#24243e] transition-colors active:scale-[0.98]"
              >
                <Github className="w-4 h-4" />
                Star on GitHub
              </a>
            </div>
          </div>
        </motion.div>
      </Section>

      {/* ============================================================ */}
      {/*  FOOTER                                                      */}
      {/* ============================================================ */}
      <footer className="border-t border-[rgba(255,255,255,0.06)] bg-[#0a0a0f]">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
            <div>
              <h4 className="text-xs uppercase tracking-wider text-zinc-500 font-medium mb-4">
                Product
              </h4>
              <ul className="space-y-2.5">
                {["Self-Healing", "Observability", "Evaluation", "Guardrails", "Gateway", "Cost Intelligence"].map(
                  (item) => (
                    <li key={item}>
                      <a href="#modules" className="text-sm text-zinc-400 hover:text-white transition-colors">
                        {item}
                      </a>
                    </li>
                  )
                )}
              </ul>
            </div>
            <div>
              <h4 className="text-xs uppercase tracking-wider text-zinc-500 font-medium mb-4">
                Developers
              </h4>
              <ul className="space-y-2.5">
                {[
                  { label: "Docs", href: "/docs" },
                  { label: "API Reference", href: "/docs/api" },
                  { label: "GitHub", href: "https://github.com/traceform/traceform" },
                  { label: "Status", href: "https://status.traceform.dev" },
                ].map((item) => (
                  <li key={item.label}>
                    {item.href.startsWith("/") ? (
                      <Link
                        href={item.href}
                        className="text-sm text-zinc-400 hover:text-white transition-colors"
                      >
                        {item.label}
                      </Link>
                    ) : (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-zinc-400 hover:text-white transition-colors inline-flex items-center gap-1"
                      >
                        {item.label}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs uppercase tracking-wider text-zinc-500 font-medium mb-4">
                Company
              </h4>
              <ul className="space-y-2.5">
                {["About", "Blog", "Careers", "Contact"].map((item) => (
                  <li key={item}>
                    <a href="#" className="text-sm text-zinc-400 hover:text-white transition-colors">
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs uppercase tracking-wider text-zinc-500 font-medium mb-4">
                Legal
              </h4>
              <ul className="space-y-2.5">
                {["Privacy Policy", "Terms of Service", "Security", "License (Apache 2.0)"].map(
                  (item) => (
                    <li key={item}>
                      <a href="#" className="text-sm text-zinc-400 hover:text-white transition-colors">
                        {item}
                      </a>
                    </li>
                  )
                )}
              </ul>
            </div>
          </div>
          <div className="flex flex-col md:flex-row items-center justify-between pt-8 border-t border-[rgba(255,255,255,0.06)]">
            <div className="flex items-center gap-4 mb-4 md:mb-0">
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center">
                  <span className="text-white font-bold text-[10px]">T</span>
                </div>
                <span className="text-sm text-zinc-500">
                  Traceform &copy; {new Date().getFullYear()}
                </span>
              </div>
              <span className="text-xs text-zinc-600 hidden md:inline">
                Built with Go, Next.js, ClickHouse, and love
              </span>
            </div>
            <div className="flex items-center gap-6">
              <a
                href="https://github.com/traceform/traceform"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <Github className="w-4 h-4" />
              </a>
              <a href="#" className="text-zinc-500 hover:text-white transition-colors">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
              </a>
              <a href="#" className="text-zinc-500 hover:text-white transition-colors">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026 13.83 13.83 0 0 0 1.226-1.963.074.074 0 0 0-.041-.104 13.175 13.175 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.245.195.372.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028z" /></svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
