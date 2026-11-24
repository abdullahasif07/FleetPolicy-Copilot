"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { StatusChip } from "@/components/decision";
import { ErrorState } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { ApiError, recordDecision, streamAnalysis } from "@/lib/api";
import { DECISION_PAST, money, shortDate } from "@/lib/format";
import type { Decision, Health, RequestDetail, RequestSummary } from "@/lib/types";
import {
  AnalyzePrompt,
  ProgressSteps,
  RecommendationCard,
  STEPS,
  type RunState,
  type StepState,
} from "./analysis-panel";
import { CitationSheet, type CitationTarget } from "./citation-sheet";
import { ActionBar, DecidedBanner, OverrideDialog, ShortcutsDialog } from "./decision-controls";
import { RequestPanel } from "./request-panel";

function initialSteps(): Record<string, StepState> {
  return Object.fromEntries(STEPS.map((s) => [s.node, { status: "waiting" as const }]));
}

export function ReviewWorkspace({ id }: { id: string }) {
  const key = `/requests/${id}`;
  const { data: detail, error, mutate } = useSWR<RequestDetail>(key);
  const { data: queue } = useSWR<RequestSummary[]>("/requests");
  const { data: health } = useSWR<Health>("/health");
  const { mutate: globalMutate } = useSWRConfig();

  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [citation, setCitation] = useState<CitationTarget | null>(null);
  const [overrideAction, setOverrideAction] = useState<Decision | null>(null);
  const [submitting, setSubmitting] = useState<Decision | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Reset local state when navigating between requests.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset per request id
    setRun({ status: "idle" });
    setCitation(null);
    setOverrideAction(null);
    return () => abortRef.current?.abort();
  }, [id]);

  const analysis = detail?.analysis ?? null;
  const decision = detail?.decision ?? null;
  const aiDecision = analysis?.recommendation.decision ?? null;

  const nextId = useMemo(() => {
    const open = (queue ?? []).filter((r) => r.status !== "decided" && r.request_id !== id);
    if (!open.length) return null;
    const order = (queue ?? []).map((r) => r.request_id);
    const here = order.indexOf(id);
    return (open.find((r) => order.indexOf(r.request_id) > here) ?? open[0]).request_id;
  }, [queue, id]);

  const analyze = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let steps = initialSteps();
    setRun({ status: "running", steps });
    try {
      await streamAnalysis(
        id,
        (e) => {
          if (e.event === "step") {
            steps = { ...steps, [e.node]: { status: e.status, ms: e.ms } };
            setRun({ status: "running", steps });
          }
        },
        controller.signal,
      );
      await Promise.all([mutate(), globalMutate("/requests")]);
      setRun({ status: "idle" });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const err = e as ApiError;
      setRun({ status: "error", message: err.message, code: err.code, steps });
      if (err.status === 429) toast.warning(err.message);
    }
  }, [id, mutate, globalMutate]);

  const submit = useCallback(
    async (action: Decision, reason?: string) => {
      setSubmitting(action);
      try {
        const out = await recordDecision(id, action, reason);
        setOverrideAction(null);
        await Promise.all([mutate(), globalMutate("/requests")]);
        toast.success(`${id} ${DECISION_PAST[action].toLowerCase()}`, {
          description: out.is_override
            ? "Override recorded in the audit log."
            : "Matches the AI recommendation.",
        });
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setSubmitting(null);
      }
    },
    [id, mutate, globalMutate],
  );

  const canDecide = !!analysis && !decision && run.status !== "running" && submitting === null;

  const choose = useCallback(
    (action: Decision) => {
      if (!canDecide) return;
      if (action === aiDecision) void submit(action);
      else setOverrideAction(action);
    },
    [canDecide, aiDecision, submit],
  );

  useHotkeys({
    a: () => choose("APPROVE"),
    e: () => choose("ESCALATE"),
    d: () => choose("DECLINE"),
    "?": () => setShowShortcuts(true),
  });

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <ErrorState
          title={error instanceof ApiError && error.status === 404 ? "Request not found" : "Couldn't load this request"}
          message={error.message}
          onRetry={error instanceof ApiError && error.status === 404 ? undefined : () => mutate()}
        />
        <p className="mt-4 text-center">
          <Link href="/" className="text-sm text-primary hover:underline">
            Back to the queue
          </Link>
        </p>
      </div>
    );
  }
  if (!detail) return <ReviewSkeleton />;

  const s = detail.summary;

  return (
    <div className="mx-auto max-w-[1440px] px-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Queue
        </Link>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{s.request_id}</span>
            <StatusChip status={s.status} human={s.human_action} />
          </div>
          <h1 className="truncate text-lg font-semibold tracking-tight">{s.headline}</h1>
        </div>
        <dl className="ml-auto flex gap-6 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Client</dt>
            <dd className="font-medium">{s.client_name}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Submitted</dt>
            <dd className="font-medium">{shortDate(s.submitted_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Amount</dt>
            <dd className="font-semibold tabular-nums">{money(s.total)}</dd>
          </div>
        </dl>
      </div>

      <div className="grid gap-6 py-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <RequestPanel detail={detail} />

        <div className="lg:sticky lg:top-20 lg:flex lg:h-[calc(100vh-6rem)] lg:flex-col">
          <div className="flex flex-1 flex-col overflow-hidden rounded-lg border bg-card">
            <div className="flex-1 overflow-y-auto p-4">
              {run.status !== "idle" ? (
                <div className="space-y-3">
                  <ProgressSteps run={run} />
                  {run.status === "error" && (
                    <ErrorState
                      title={run.code === "rate_limited" || run.code === "spend_cap" ? "Limit reached" : "Analysis failed"}
                      message={run.message}
                      onRetry={run.code === "spend_cap" ? undefined : analyze}
                    />
                  )}
                </div>
              ) : analysis ? (
                <RecommendationCard
                  analysis={analysis}
                  whatIf={detail.what_if}
                  onOpenCitation={(sectionId, quote) => setCitation({ sectionId, quote })}
                  onReanalyze={analyze}
                  canReanalyze={!decision}
                />
              ) : (
                <AnalyzePrompt onAnalyze={analyze} llmConfigured={health?.llm_configured} />
              )}
            </div>
            {decision ? (
              <DecidedBanner decision={decision} nextId={nextId} />
            ) : (
              <ActionBar
                aiDecision={run.status === "idle" ? aiDecision : null}
                disabled={!canDecide}
                submitting={submitting}
                onChoose={choose}
                onShowShortcuts={() => setShowShortcuts(true)}
              />
            )}
          </div>
        </div>
      </div>

      <CitationSheet
        clientId={detail.client.client_id}
        target={citation}
        onClose={() => setCitation(null)}
      />
      <OverrideDialog
        key={overrideAction ?? "none"}
        action={overrideAction}
        aiDecision={aiDecision}
        submitting={submitting !== null}
        onCancel={() => setOverrideAction(null)}
        onConfirm={(reason) => overrideAction && submit(overrideAction, reason)}
      />
      <ShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} />
    </div>
  );
}

export function ReviewSkeleton() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 sm:px-6" aria-busy="true">
      <div className="flex items-center gap-4 border-b py-4">
        <Skeleton className="h-4 w-16" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-72" />
        </div>
        <Skeleton className="ml-auto h-9 w-64" />
      </div>
      <div className="grid gap-6 py-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="space-y-4">
          <Skeleton className="h-52 w-full" />
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
        <Skeleton className="h-[560px] w-full" />
      </div>
    </div>
  );
}
