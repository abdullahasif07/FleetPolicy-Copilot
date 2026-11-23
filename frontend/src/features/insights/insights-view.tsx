"use client";

import Link from "next/link";
import useSWR from "swr";
import { ShieldAlert } from "lucide-react";
import { DecisionBadge } from "@/components/decision";
import { EmptyState, ErrorState } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";
import { dateTime, money } from "@/lib/format";
import type { AuditEntry, Metrics } from "@/lib/types";
import {
  ConfusionMatrix,
  DecisionMixBars,
  Histogram,
  MeterList,
  StatTile,
  pct,
} from "./charts";

const TAG_LABELS: Record<string, string> = {
  easy_approval: "Easy approvals",
  clear_decline: "Clear declines",
  warranty: "Warranty",
  edge_case: "Edge cases",
  missing_info: "Missing information",
  injection: "Prompt injection",
  llm_judgment: "Needs AI judgement",
  over_limit: "Over spending limit",
  pre_approval: "Pre-approval items",
  vendor: "Vendor rules",
  labor_cap: "Labour-rate cap",
  parts_markup: "Parts markup",
  quotes: "Quote rules",
  exclusion: "Exclusions",
  pm_interval: "Maintenance interval",
  always_escalate: "Always escalate",
  safety: "Safety items",
  safety_override: "Safety limit",
};

const seconds = (ms: number | null | undefined) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`);

function Panel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border bg-card p-5 ${className ?? ""}`}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function InsightsView() {
  const { data, error, mutate } = useSWR<Metrics>("/metrics");
  const audit = useSWR<AuditEntry[]>("/audit?limit=50");

  if (error) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
        <ErrorState title="Couldn't load insights" message={error.message} onRetry={() => mutate()} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-[1440px] space-y-4 px-4 py-6 sm:px-6">
        <Skeleton className="h-7 w-40" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  const u = data.usage;
  const ev = data.evals;
  const m = ev?.metrics;
  const tags = ev
    ? Object.entries(ev.by_tag)
        .filter(([t]) => TAG_LABELS[t])
        .sort((a, b) => b[1].n - a[1].n)
    : [];

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight">Insights</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        How the copilot is performing: live usage from this demo, and the latest offline evaluation.
      </p>

      {/* Live usage ------------------------------------------------------------------- */}
      <h2 className="mt-8 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Live usage
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="AI–human agreement"
          value={pct(u.agreement_rate)}
          detail={u.decided_requests ? `${u.decided_requests} decisions · ${u.override_count} overrides` : "No decisions yet"}
        />
        <StatTile
          label="Escalation rate"
          value={pct(u.escalation_rate)}
          detail={u.analyzed_requests ? `of ${u.analyzed_requests} analyzed requests` : "Nothing analyzed yet"}
        />
        <StatTile
          label="Avg analysis time"
          value={seconds(u.avg_latency_ms)}
          detail={u.p95_latency_ms != null ? `p95 ${seconds(u.p95_latency_ms)}` : undefined}
        />
        <StatTile
          label="Cost per request"
          value={u.avg_cost_usd == null ? "—" : `$${u.avg_cost_usd.toFixed(4)}`}
          detail={`Today $${u.spend_today_usd.toFixed(3)} of $${u.daily_spend_cap_usd.toFixed(2)} cap`}
        />
        <StatTile
          label="Analyzed"
          value={`${u.analyzed_requests} / ${u.total_requests}`}
          detail={`${u.analysis_runs} analysis runs`}
        />
        <StatTile
          label="Injections flagged"
          value={String(u.injections_flagged)}
          detail={`${u.rule_overrides_of_ai} AI suggestions overridden by rules`}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel
          title="AI recommendations vs human decisions"
          description="Latest AI recommendation per analyzed request, and the decision a person recorded."
        >
          <DecisionMixBars
            rows={[
              { label: "AI recommendations", mix: u.ai_decision_mix },
              { label: "Human decisions", mix: u.human_decision_mix },
            ]}
          />
          {Object.keys(u.override_pairs).length > 0 && (
            <p className="mt-4 text-xs text-muted-foreground">
              Overrides:{" "}
              {Object.entries(u.override_pairs)
                .map(([pair, n]) => `${pair.replace("->", " → ").toLowerCase()} (${n})`)
                .join(", ")}
            </p>
          )}
        </Panel>

        <Panel title="Recent decisions" description="Audit log: AI recommendation vs the human's final call.">
          {audit.error ? (
            <ErrorState message={audit.error.message} onRetry={() => audit.mutate()} />
          ) : !audit.data ? (
            <Skeleton className="h-40" />
          ) : audit.data.length === 0 ? (
            <EmptyState
              title="No decisions yet"
              message="Decisions you record in the review workspace appear here."
              action={
                <Link href="/" className="text-sm text-primary hover:underline">
                  Go to the queue
                </Link>
              }
            />
          ) : (
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-2 font-medium">Request</th>
                    <th className="py-1.5 pr-2 font-medium">AI</th>
                    <th className="py-1.5 pr-2 font-medium">Human</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Amount</th>
                    <th className="py-1.5 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.data.map((a) => (
                    <tr key={a.request_id} className="border-t align-top">
                      <td className="py-2 pr-2">
                        <Link href={`/requests/${a.request_id}`} className="font-mono text-xs hover:underline">
                          {a.request_id}
                        </Link>
                        {a.injection_detected && (
                          <ShieldAlert className="ml-1 inline size-3 text-decline" aria-label="Injection flagged" />
                        )}
                        <div className="text-xs text-muted-foreground">{a.client_name}</div>
                        {a.override_reason && (
                          <div className="mt-0.5 text-xs italic text-muted-foreground">“{a.override_reason}”</div>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <DecisionBadge decision={a.ai_decision} />
                      </td>
                      <td className="py-2 pr-2">
                        <DecisionBadge decision={a.human_action} past />
                        {a.is_override && <div className="mt-0.5 text-[11px] text-muted-foreground">override</div>}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">{money(a.total)}</td>
                      <td className="py-2 text-right text-xs whitespace-nowrap text-muted-foreground">
                        {dateTime(a.decided_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* Evaluation ------------------------------------------------------------------- */}
      <div className="mt-10 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Evaluation · {m ? `${m.n} labelled requests` : "not run yet"}
        </h2>
        {ev && (
          <p className="text-xs text-muted-foreground">
            {ev.mode === "live" ? ev.models.llm : "offline stand-in"} · run {dateTime(ev.generated_at)}
          </p>
        )}
      </div>

      {!ev || !m ? (
        <EmptyState
          className="mt-3"
          title="No evaluation results yet"
          message="Run `make evals` to score the system on the 40 labelled requests. Results appear here."
        />
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Decision accuracy" value={pct(m.decision_accuracy)} detail="target ≥ 85%" />
            <StatTile label="Citation accuracy" value={pct(m.citation_accuracy)} detail="cites the expected section" />
            <StatTile label="Injection resistance" value={pct(m.injection_resistance)} detail="target 100%" />
            <StatTile
              label="Uncited approve/decline"
              value={String(m.uncited_final_decisions)}
              detail="target 0"
            />
            <StatTile label="Latency p50 / p95" value={seconds(m.p50_latency_ms)} detail={`p95 ${seconds(m.p95_latency_ms)}`} />
            <StatTile label="Avg cost per request" value={`$${m.avg_cost_usd.toFixed(4)}`} detail={`$${m.total_cost_usd.toFixed(3)} for the full run`} />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Panel title="Quality vs targets" description="Tick marks show the target where one is set.">
              <MeterList
                ariaLabel="Evaluation metrics against targets"
                rows={[
                  { label: "Decision accuracy", value: m.decision_accuracy, target: 0.85 },
                  { label: "Citation accuracy", value: m.citation_accuracy },
                  { label: "Injection resistance", value: m.injection_resistance, target: 1 },
                  { label: "Injection detection", value: m.injection_detection },
                  { label: "Warranty recall", value: m.warranty_recall },
                ]}
              />
            </Panel>
            <Panel
              title="What each layer contributes"
              description="Decision accuracy of the model alone, the rule engine alone, and the combined system."
            >
              <MeterList
                ariaLabel="Accuracy by layer"
                rows={[
                  { label: "AI model alone", value: m.llm_only_accuracy, note: "before rule override" },
                  { label: "Rule engine alone", value: m.rules_only_accuracy },
                  { label: "Combined system", value: m.decision_accuracy, target: 0.85 },
                ]}
              />
              <p className="mt-4 text-xs text-muted-foreground">
                Rules catch hard limits deterministically; the model reads what rules can&apos;t (e.g. an
                accessory filed under the wrong category). The validator keeps every approval or decline cited.
              </p>
            </Panel>
            <Panel title="Accuracy by scenario" description="Requests can carry several tags.">
              <MeterList
                ariaLabel="Decision accuracy by scenario"
                rows={tags.map(([t, v]) => ({
                  label: TAG_LABELS[t],
                  value: v.decision_accuracy,
                  note: `n=${v.n}`,
                }))}
              />
            </Panel>
            <div className="grid gap-3">
              <Panel title="Analysis time per request" description="Distribution across the evaluation run.">
                <Histogram
                  values={ev.items.map((i) => i.latency_ms / 1000)}
                  binSize={0.5}
                  unit="s"
                  format={(v) => v.toFixed(1)}
                  ariaLabel="Histogram of analysis time per request"
                />
              </Panel>
              <Panel title="Confusion matrix" description="Expected decision (rows) vs system decision (columns).">
                <ConfusionMatrix matrix={ev.confusion_matrix} />
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
