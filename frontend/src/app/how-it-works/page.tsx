import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Brain,
  ClipboardList,
  Database,
  FileSearch,
  Gavel,
  ListChecks,
  ShieldCheck,
  UserCheck,
} from "lucide-react";

export const metadata: Metadata = { title: "How it works" };

const STEPS = [
  {
    icon: ClipboardList,
    title: "Read the request",
    body: "The shop's request is checked and tidied into a standard format. Shop notes are marked as untrusted text and scanned for attempts to trick the AI.",
  },
  {
    icon: Database,
    title: "Look up the records",
    body: "The vehicle (mileage, age, warranty) and the client's policy settings are fetched from the fleet records.",
  },
  {
    icon: FileSearch,
    title: "Find the relevant policy",
    body: "Search finds the most relevant sections of this client's policy, by matching keywords and meaning. Other clients' policies are never searched.",
  },
  {
    icon: ListChecks,
    title: "Check the hard rules",
    body: "Plain code, not AI, checks spending limits, approved vendors, warranty, labour rates and service intervals. These results can't be talked out of.",
  },
  {
    icon: Brain,
    title: "Reason about it",
    body: "The AI reads the request, the rule results and the policy text, then recommends Approve, Escalate or Decline, quoting the exact policy sentences it relied on.",
  },
  {
    icon: ShieldCheck,
    title: "Double-check the evidence",
    body: "Every quote is checked word-for-word against the policy. Rule findings override the AI. If there's no valid citation, the answer becomes Escalate.",
  },
  {
    icon: UserCheck,
    title: "A person decides",
    body: "The associate sees the recommendation and evidence, then approves, escalates or declines. Disagreeing with the AI requires a short reason, which is logged.",
  },
];

const GUARDRAILS = [
  ["The AI never decides", "Every recommendation needs a human to approve or override it."],
  ["No evidence, no verdict", "An approval or decline without a verified policy quote is automatically escalated."],
  ["Rules beat the model", "Hard limits are checked in code; the AI can't approve past them."],
  ["Shop notes can't give orders", "Notes are fenced off as untrusted data; injection attempts are flagged and ignored."],
  ["Spending is capped", "Per-session rate limits and a daily AI budget, with retries and a backup model."],
  ["Everything is auditable", "Each analysis stores its model, cost, timing, citations and the human's final call."],
];

function Box({
  icon: Icon,
  title,
  sub,
  tone = "default",
}: {
  icon: typeof Brain;
  title: string;
  sub: string;
  tone?: "default" | "accent" | "muted";
}) {
  const tones = {
    default: "bg-card",
    accent: "border-primary/40 bg-primary/5",
    muted: "bg-muted/50",
  };
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border p-3 ${tones[tone]}`}>
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <p className="text-xs font-medium text-primary">How it works</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        An AI assistant that checks repair requests against each client&apos;s rulebook
      </h1>
      <p className="mt-3 max-w-3xl text-muted-foreground">
        Fleet maintenance teams review hundreds of repair requests from garages. Each client company
        has its own policy: spending limits, approved garages, warranty rules. FleetPolicy Copilot
        reads the request, finds the relevant rules, and recommends a decision with the exact policy
        sentences as evidence. A person always makes the final call.
      </p>

      {/* Architecture diagram ------------------------------------------------------- */}
      <section aria-labelledby="arch" className="mt-10">
        <h2 id="arch" className="text-lg font-semibold">Architecture</h2>
        <div
          className="mt-4 rounded-xl border bg-muted/20 p-4 sm:p-6"
          role="img"
          aria-label="Architecture: the web app sends requests to the API, which runs a six-step agent workflow using a policy search index, a rule engine and an OpenAI model, and stores every result in an audit database."
        >
          <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr_auto_2.2fr]">
            <Box icon={UserCheck} title="Web app" sub="Next.js · queue, review, policies, insights" />
            <ArrowRight className="mx-auto hidden size-4 text-muted-foreground md:block" aria-hidden />
            <ArrowDown className="mx-auto size-4 text-muted-foreground md:hidden" aria-hidden />
            <Box icon={Gavel} title="API" sub="FastAPI · validation, rate limits, spend cap, live progress" />
            <ArrowRight className="mx-auto hidden size-4 text-muted-foreground md:block" aria-hidden />
            <ArrowDown className="mx-auto size-4 text-muted-foreground md:hidden" aria-hidden />
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
              <p className="text-sm font-medium">Agent workflow (LangGraph)</p>
              <ol className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
                {["parse", "load context", "retrieve", "rule check", "reason", "validate"].map((s, i, arr) => (
                  <li key={s} className="flex items-center gap-1">
                    <span className="rounded border bg-background px-1.5 py-0.5">{s}</span>
                    {i < arr.length - 1 && <ArrowRight className="size-3 text-muted-foreground" aria-hidden />}
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 md:ml-auto md:w-[58%] md:grid-cols-2">
            <Box icon={FileSearch} title="Policy search" sub="Keyword (BM25) + meaning (embeddings) in ChromaDB" tone="muted" />
            <Box icon={ListChecks} title="Rule engine" sub="Deterministic Python checks" tone="muted" />
            <Box icon={Brain} title="OpenAI model" sub="Structured output · retries · backup model" tone="muted" />
            <Box icon={Database} title="Audit database" sub="SQLite · analyses, decisions, usage" tone="muted" />
          </div>
        </div>
      </section>

      {/* Steps ------------------------------------------------------------------- */}
      <section aria-labelledby="steps" className="mt-10">
        <h2 id="steps" className="text-lg font-semibold">What happens when you click Analyze</h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3 rounded-lg border bg-card p-4">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <div>
                <p className="flex items-center gap-1.5 font-medium">
                  <s.icon className="size-4 text-muted-foreground" aria-hidden />
                  {s.title}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Guardrails --------------------------------------------------------------- */}
      <section aria-labelledby="guardrails" className="mt-10">
        <h2 id="guardrails" className="text-lg font-semibold">Safety guardrails</h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {GUARDRAILS.map(([t, d]) => (
            <div key={t} className="rounded-lg border p-4">
              <dt className="flex items-center gap-1.5 text-sm font-medium">
                <ShieldCheck className="size-4 text-approve" aria-hidden />
                {t}
              </dt>
              <dd className="mt-1 text-sm text-muted-foreground">{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Measuring -------------------------------------------------------------- */}
      <section aria-labelledby="measure" className="mt-10 rounded-xl border bg-card p-6">
        <h2 id="measure" className="text-lg font-semibold">How we know it works</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          40 sample requests (easy approvals, clear declines, warranty cases, missing information,
          tricky edge cases and three prompt-injection attempts) each have a known correct answer
          and policy section. An evaluation script runs all of them through the system and measures
          decision accuracy, citation accuracy, injection resistance, speed and cost.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/insights"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            See the results <ArrowRight className="size-3.5" />
          </Link>
          <Link
            href="/policies/NW"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            <BookOpen className="size-3.5" /> Read a sample policy
          </Link>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          All companies, vehicles, garages and policies in this demo are fictional.
        </p>
      </section>
    </div>
  );
}
