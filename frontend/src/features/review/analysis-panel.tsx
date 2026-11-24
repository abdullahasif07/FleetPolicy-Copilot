"use client";

import {
  ArrowRight,
  BadgeDollarSign,
  CheckCircle2,
  ChevronRight,
  CircleX,
  Info,
  Lightbulb,
  Loader2,
  RotateCw,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { DECISION_STYLES } from "@/components/decision";
import { Button } from "@/components/ui/button";
import { DECISION_LABEL, money, number } from "@/lib/format";
import type { AnalysisResult, Decision, RuleFlag, Severity, WhatIfResult } from "@/lib/types";
import { cn } from "@/lib/utils";

export const STEPS = [
  { node: "parse_request", label: "Reading request" },
  { node: "load_context", label: "Loading vehicle and client records" },
  { node: "retrieve_policy", label: "Retrieving policy" },
  { node: "rule_check", label: "Checking rules" },
  { node: "reason", label: "Reasoning" },
  { node: "validate", label: "Validating citations" },
] as const;

export type StepState = { status: "waiting" | "running" | "done"; ms?: number | null };
export type RunState =
  | { status: "idle" }
  | { status: "running"; steps: Record<string, StepState> }
  | { status: "error"; message: string; code?: string; steps: Record<string, StepState> };

export type OpenCitation = (sectionId: string, quote?: string | null) => void;

// --- Before / during analysis -------------------------------------------------------------

export function AnalyzePrompt({
  onAnalyze,
  disabled,
  llmConfigured,
}: {
  onAnalyze: () => void;
  disabled?: boolean;
  llmConfigured: boolean | undefined;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="size-5" aria-hidden />
      </span>
      <h2 className="mt-3 font-semibold">Get an AI recommendation</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Retrieves the relevant policy clauses, runs the deterministic rule checks, and recommends
        a decision with cited evidence. You make the final call.
      </p>
      <Button className="mt-5" onClick={onAnalyze} disabled={disabled || llmConfigured === false}>
        <Sparkles className="size-4" /> Analyze request
      </Button>
      {llmConfigured === false && (
        <p className="mt-3 text-xs text-decline">
          AI analysis is unavailable: the backend has no OpenAI API key configured.
        </p>
      )}
    </div>
  );
}

export function ProgressSteps({ run }: { run: Exclude<RunState, { status: "idle" }> }) {
  return (
    <div className="rounded-lg border p-5" aria-live="polite">
      <p className="text-sm font-semibold">
        {run.status === "error" ? "Analysis stopped" : "Analyzing…"}
      </p>
      <ol className="mt-4 space-y-3">
        {STEPS.map((s) => {
          const st = run.steps[s.node] ?? { status: "waiting" };
          const failed = run.status === "error" && st.status === "running";
          return (
            <li key={s.node} className="flex items-center gap-3 text-sm">
              <span className="flex size-5 items-center justify-center">
                {failed ? (
                  <CircleX className="size-4 text-decline" aria-hidden />
                ) : st.status === "done" ? (
                  <CheckCircle2 className="size-4 text-approve" aria-hidden />
                ) : st.status === "running" ? (
                  <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                ) : (
                  <span className="size-2 rounded-full bg-muted-foreground/30" aria-hidden />
                )}
              </span>
              <span
                className={cn(
                  st.status === "waiting" && "text-muted-foreground",
                  st.status === "running" && !failed && "font-medium",
                )}
              >
                {s.label}
                {st.status === "running" && !failed && "…"}
              </span>
              {st.status === "done" && st.ms != null && (
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {st.ms < 1000 ? `${Math.round(st.ms)} ms` : `${(st.ms / 1000).toFixed(1)} s`}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// --- Recommendation -----------------------------------------------------------------------

const SEVERITY: Record<Severity, { icon: typeof Info; className: string; label: string }> = {
  block: { icon: CircleX, className: "text-decline", label: "Requires decline" },
  escalate: { icon: TriangleAlert, className: "text-escalate", label: "Requires escalation" },
  info: { icon: CheckCircle2, className: "text-muted-foreground", label: "Check" },
};

function SectionChip({
  sectionId,
  onOpen,
  quote,
}: {
  sectionId: string;
  onOpen: OpenCitation;
  quote?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(sectionId, quote)}
      className="inline-flex items-center rounded border bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      aria-label={`Open policy section ${sectionId}`}
    >
      {sectionId}
    </button>
  );
}

function FlagRow({ flag, onOpen }: { flag: RuleFlag; onOpen: OpenCitation }) {
  const s = SEVERITY[flag.severity];
  const Icon = s.icon;
  return (
    <li className="flex items-start gap-2.5 py-1.5 text-sm">
      <Icon className={cn("mt-0.5 size-4 shrink-0", s.className)} aria-label={s.label} />
      <span className="flex-1">{flag.message}</span>
      <SectionChip sectionId={flag.section_id} onOpen={onOpen} />
    </li>
  );
}

function Outcome({ decision }: { decision: Decision }) {
  const s = DECISION_STYLES[decision];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        s.soft,
        s.text,
      )}
    >
      <ArrowRight className="size-3" aria-hidden />
      {DECISION_LABEL[decision]}
    </span>
  );
}

function WhatWouldChange({ whatIf, onOpen }: { whatIf: WhatIfResult; onOpen: OpenCitation }) {
  if (!whatIf.items.length) return null;
  return (
    <section aria-label="What would change this">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <Lightbulb className="size-3.5" aria-hidden /> What would change this
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        The rule checks re-run with one change at a time. The AI&apos;s judgement isn&apos;t re-run.
      </p>
      <ul className="mt-2 divide-y rounded-lg border">
        {whatIf.items.map((w) => (
          <li key={`${w.rule}-${w.change}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <span className={cn("min-w-0 flex-1", !w.fixable && "text-muted-foreground")}>
              {w.change}
              {w.note && <span className="block text-xs text-muted-foreground">{w.note}</span>}
            </span>
            {w.decision_after ? (
              <Outcome decision={w.decision_after} />
            ) : (
              !w.fixable && <span className="text-xs text-muted-foreground">No change</span>
            )}
            <SectionChip sectionId={w.section_id} onOpen={onOpen} />
          </li>
        ))}
        {whatIf.all_changes_floor && (
          <li className="flex items-center gap-3 bg-muted/40 px-3 py-2 text-sm font-medium">
            <span className="flex-1">With all of these changes</span>
            <Outcome decision={whatIf.all_changes_floor} />
          </li>
        )}
      </ul>
    </section>
  );
}

export function RecommendationCard({
  analysis,
  whatIf,
  onOpenCitation,
  onReanalyze,
  canReanalyze,
}: {
  analysis: AnalysisResult;
  whatIf?: WhatIfResult;
  onOpenCitation: OpenCitation;
  onReanalyze?: () => void;
  canReanalyze: boolean;
}) {
  const rec = analysis.recommendation;
  const trace = analysis.trace;
  const style = DECISION_STYLES[rec.decision];
  const Icon = style.icon;
  const pct = Math.round(rec.confidence * 100);
  const issues = rec.rule_flags.filter((f) => f.severity !== "info");
  const checks = rec.rule_flags.filter((f) => f.severity === "info");

  return (
    <div className="space-y-4">
      <section
        aria-label="AI recommendation"
        className={cn("overflow-hidden rounded-lg border", style.border)}
      >
        <div className={cn("flex flex-wrap items-center gap-3 px-4 py-3", style.soft)}>
          <Icon className={cn("size-6", style.text)} aria-hidden />
          <div>
            <p className="text-xs font-medium text-muted-foreground">AI recommendation</p>
            <p className={cn("text-lg leading-tight font-semibold", style.text)}>
              {DECISION_LABEL[rec.decision]}
            </p>
          </div>
          <div className="ml-auto w-40">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Confidence</span>
              <span className="font-medium tabular-nums">{pct}%</span>
            </div>
            <div
              className="mt-1 h-1.5 overflow-hidden rounded-full bg-background/70"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Confidence"
            >
              <div className={cn("h-full rounded-full", style.bar)} style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
        <div className="space-y-3 px-4 py-3">
          <p className="text-sm leading-relaxed">{rec.summary}</p>
          {rec.overridden_by_rules && rec.llm_decision && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="size-3.5" aria-hidden />
              The model suggested {DECISION_LABEL[rec.llm_decision]}; deterministic rule checks
              changed it to {DECISION_LABEL[rec.decision]}.
            </p>
          )}
        </div>
      </section>

      {rec.injection_detected && (
        <div
          role="alert"
          className="flex gap-2.5 rounded-lg border border-decline/30 bg-decline-soft p-3 text-sm"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-decline" aria-hidden />
          <div>
            <p className="font-medium text-decline">Prompt-injection attempt ignored</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The shop notes tried to instruct the reviewer ({rec.injection_signals.join(", ")}).
              The recommendation is based on policy and rule checks only. Consider reporting this
              vendor.
            </p>
          </div>
        </div>
      )}

      {rec.warranty_opportunity && (
        <div className="flex gap-2.5 rounded-lg border border-approve/30 bg-approve-soft p-3 text-sm">
          <BadgeDollarSign className="mt-0.5 size-4 shrink-0 text-approve" aria-hidden />
          <div>
            <p className="font-medium text-approve">Warranty opportunity</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Some of this work appears to be covered by an active warranty.
              {rec.estimated_savings > 0 && (
                <>
                  {" "}
                  Estimated savings: <span className="font-medium text-foreground">{money(rec.estimated_savings)}</span>.
                </>
              )}
            </p>
          </div>
        </div>
      )}

      <section aria-label="Reasons">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Why ({rec.reasons.length})
        </h3>
        {rec.reasons.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No verified policy citation was available, so the request is escalated for human review.
          </p>
        ) : (
          <ol className="mt-2 space-y-2.5">
            {rec.reasons.map((r, i) => (
              <li key={i} className="rounded-lg border p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
                    {i + 1}
                  </span>
                  <p className="flex-1 text-sm">{r.text}</p>
                  <span className="shrink-0 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    {r.source === "rule" ? "Rule check" : "AI"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenCitation(r.citation_section_id, r.quoted_clause)}
                  className="group mt-2 ml-7 block w-[calc(100%-1.75rem)] rounded-md border-l-2 border-primary/40 bg-muted/40 px-3 py-2 text-left text-xs leading-relaxed text-foreground/80 transition-colors hover:border-primary hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="italic">&ldquo;{r.quoted_clause}&rdquo;</span>
                  <span className="mt-1.5 flex items-center gap-1 font-mono text-[11px] text-primary">
                    {r.citation_section_id}
                    <ChevronRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-label="Rule checks">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Rule checks
        </h3>
        <ul className="mt-1 divide-y">
          {issues.map((f, i) => (
            <FlagRow key={`i${i}`} flag={f} onOpen={onOpenCitation} />
          ))}
          {checks.map((f, i) => (
            <FlagRow key={`c${i}`} flag={f} onOpen={onOpenCitation} />
          ))}
        </ul>
      </section>

      {whatIf && <WhatWouldChange whatIf={whatIf} onOpen={onOpenCitation} />}

      <details className="group rounded-lg border px-3 py-2 text-xs">
        <summary className="cursor-pointer select-none text-muted-foreground marker:text-muted-foreground">
          Audit details
        </summary>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Model</dt>
            <dd className="font-medium">
              {trace.model ?? "rules only"}
              {trace.fallback_used && " (fallback)"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Latency</dt>
            <dd className="font-medium tabular-nums">{(trace.latency_ms / 1000).toFixed(2)} s</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Cost</dt>
            <dd className="font-medium tabular-nums">${trace.cost_usd.toFixed(5)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Tokens in / out</dt>
            <dd className="font-medium tabular-nums">
              {number(trace.tokens_in)} / {number(trace.tokens_out)}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted-foreground">Rule floor · model said</dt>
            <dd className="font-medium">
              {DECISION_LABEL[rec.decision_floor]} · {rec.llm_decision ? DECISION_LABEL[rec.llm_decision] : "n/a"}
            </dd>
          </div>
          <div className="col-span-full">
            <dt className="text-muted-foreground">Retrieved sections</dt>
            <dd className="mt-0.5 flex flex-wrap gap-1">
              {analysis.retrieved.map((c) => (
                <SectionChip key={c.chunk.section_id} sectionId={c.chunk.section_id} onOpen={onOpenCitation} />
              ))}
            </dd>
          </div>
          {rec.validation_notes.length > 0 && (
            <div className="col-span-full">
              <dt className="text-muted-foreground">Validation notes</dt>
              <dd>
                <ul className="mt-0.5 list-disc pl-4">
                  {rec.validation_notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          {trace.error && (
            <div className="col-span-full text-decline">
              <dt>Error</dt>
              <dd>{trace.error}</dd>
            </div>
          )}
          <div className="col-span-full">
            <dt className="text-muted-foreground">Run ID</dt>
            <dd className="font-mono">{trace.run_id}</dd>
          </div>
        </dl>
      </details>

      {canReanalyze && onReanalyze && (
        <Button variant="ghost" size="sm" onClick={onReanalyze} className="text-muted-foreground">
          <RotateCw className="size-3.5" /> Re-run analysis
        </Button>
      )}
    </div>
  );
}
