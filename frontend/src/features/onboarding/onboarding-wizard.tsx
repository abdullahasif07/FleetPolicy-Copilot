"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  FileText,
  Loader2,
  PencilLine,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiError,
  checkClient,
  createClient,
  draftPolicy,
  getOnboardingSample,
  parsePolicy,
  type OnboardBody,
} from "@/lib/api";
import type { ClientPolicy, Health, Issue, PolicyChunk, Shop } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SettingsForm } from "./settings-form";

interface Draft {
  sections: PolicyChunk[];
  notes: string[];
  source: "ai" | "manual";
  model?: string;
  costUsd?: number;
}

const VEHICLE_HEADER =
  "unit_number,make,model,year,powertrain,mileage,in_service_date,last_pm_mileage\n";

function blankPolicy(clientId: string): ClientPolicy {
  return {
    client_id: clientId,
    name: "",
    policy_file: "",
    summary: "",
    auto_approve_limit: 0,
    category_limits: {},
    quote_threshold: null,
    quotes_required: 0,
    limit_with_quotes: null,
    approved_vendors: [],
    non_approved_vendor_action: "escalate",
    labor_rate_cap: 0,
    labor_cap_action: "escalate",
    pre_approval_categories: [],
    always_escalate_categories: [],
    excluded_categories: [],
    pm_interval_miles: null,
    pm_min_miles: null,
    parts_markup_review_pct: null,
    sections: {},
  };
}

export function OnboardingWizard() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { data: health } = useSWR<Health>("/health");
  const { data: shops } = useSWR<Shop[]>("/shops");

  const [markdown, setMarkdown] = useState("");
  const [vehiclesCsv, setVehiclesCsv] = useState(VEHICLE_HEADER);
  const [busy, setBusy] = useState<"sample" | "draft" | "manual" | "save" | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [policy, setPolicy] = useState<ClientPolicy | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [checking, setChecking] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const textRef = useRef<HTMLDivElement>(null);

  const llmReady = health?.llm_configured !== false;
  const body: OnboardBody | null = policy
    ? { policy_markdown: markdown, policy, vehicles_csv: vehiclesCsv }
    : null;

  // Re-run the deterministic checks shortly after each edit.
  const bodyKey = body ? JSON.stringify(body) : null;
  useEffect(() => {
    if (!bodyKey) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const out = await checkClient(JSON.parse(bodyKey) as OnboardBody, controller.signal);
        setIssues(out.issues);
        setVehicleCount(out.vehicle_count);
      } catch {
        /* keep the last result; saving re-validates on the server */
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [bodyKey]);

  async function loadSample() {
    setBusy("sample");
    setInputError(null);
    try {
      const s = await getOnboardingSample();
      setMarkdown(s.policy_markdown);
      setVehiclesCsv(s.vehicles_csv);
    } catch (e) {
      setInputError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runDraft() {
    setBusy("draft");
    setInputError(null);
    try {
      const d = await draftPolicy(markdown);
      setDraft({ sections: d.sections, notes: d.notes, source: "ai", model: d.model, costUsd: d.cost_usd });
      setPolicy(d.policy);
      setIssues(d.issues);
      window.scrollTo({ top: 0 });
    } catch (e) {
      const err = e as ApiError;
      setInputError(err.message);
      if (err.status === 429) toast.warning(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function fillManually() {
    setBusy("manual");
    setInputError(null);
    try {
      const parsed = await parsePolicy(markdown);
      setDraft({ sections: parsed.sections, notes: [], source: "manual" });
      setPolicy(blankPolicy(parsed.client_id));
      setIssues([]);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setInputError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!body) return;
    setBusy("save");
    try {
      const created = await createClient(body);
      await mutate("/clients");
      toast.success(`${created.name} is ready`, {
        description: "Its policy is searchable and new requests can use it.",
      });
      router.push(`/policies/${created.client_id}`);
    } catch (e) {
      const err = e as ApiError;
      if (err.issues) setIssues(err.issues);
      toast.error(err.message);
      setBusy(null);
    }
  }

  function showSection(sectionId: string) {
    setActiveSection(sectionId);
    requestAnimationFrame(() =>
      textRef.current
        ?.querySelector(`[data-section="${sectionId}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  }

  // --- Stage 1: the policy document ------------------------------------------------
  if (!policy || !draft) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <Header />
        <Card className="mt-6 gap-4 py-5">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 px-5">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="size-4 text-muted-foreground" aria-hidden />
              Policy document (Markdown)
            </CardTitle>
            <Button variant="outline" size="sm" onClick={loadSample} disabled={busy !== null}>
              {busy === "sample" && <Loader2 className="size-4 animate-spin" />}
              Load sample policy
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 px-5">
            <Textarea
              aria-label="Policy document"
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              rows={18}
              spellCheck={false}
              className="min-h-[360px] font-mono text-xs leading-relaxed"
              placeholder={"# Client name — Fleet Maintenance Policy\n\n## 2. Spending Authority\n\n### AB-2.1 Approval limit\n\nRepair requests with a total of $500.00 or less may be approved…"}
            />
            <p className="text-xs text-muted-foreground">
              Sections need numbered headings like{" "}
              <code className="rounded bg-muted px-1 font-mono">### AB-2.1 Approval limit</code>, where
              AB is the new client&apos;s two-letter ID. The text is treated as data: instructions
              inside it are ignored.
            </p>
            {inputError && (
              <p role="alert" className="flex gap-1.5 text-sm text-decline">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {inputError}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button onClick={runDraft} disabled={!markdown.trim() || busy !== null || !llmReady}>
                {busy === "draft" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {busy === "draft" ? "Reading the policy…" : "Draft settings with AI"}
              </Button>
              <Button variant="ghost" onClick={fillManually} disabled={!markdown.trim() || busy !== null}>
                {busy === "manual" ? <Loader2 className="size-4 animate-spin" /> : <PencilLine className="size-4" />}
                Fill in by hand
              </Button>
              {!llmReady && (
                <span className="text-xs text-muted-foreground">
                  No OpenAI key is configured, so AI drafting is off.
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- Stage 2: review ---------------------------------------------------------------
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <button
            type="button"
            onClick={() => {
              setPolicy(null);
              setDraft(null);
            }}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Edit policy text
          </button>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            Review {policy.name || "the new client"}
            <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">{policy.client_id}</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {draft.source === "ai"
              ? "The AI drafted these settings. Check each one against the policy text, then save."
              : "Fill in the settings from the policy text, then save."}
          </p>
        </div>
      </div>

      <div className="grid gap-6 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <SettingsForm
          policy={policy}
          onChange={(patch) => setPolicy((p) => (p ? { ...p, ...patch } : p))}
          issues={issues}
          sections={draft.sections}
          shops={shops ?? []}
          vehiclesCsv={vehiclesCsv}
          onVehiclesCsv={setVehiclesCsv}
          vehicleCount={vehicleCount}
          onShowSection={showSection}
        />

        <aside className="space-y-4 lg:sticky lg:top-20 lg:flex lg:h-[calc(100vh-6rem)] lg:flex-col lg:space-y-4">
          <Card className="gap-3 py-4">
            <CardContent className="space-y-3 px-4">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {errors.length ? (
                    <CircleAlert className="size-4 text-decline" aria-hidden />
                  ) : (
                    <CheckCircle2 className="size-4 text-approve" aria-hidden />
                  )}
                  {errors.length
                    ? `${errors.length} problem${errors.length === 1 ? "" : "s"} to fix`
                    : "Ready to save"}
                  {warnings.length > 0 && (
                    <span className="font-normal text-muted-foreground">
                      · {warnings.length} to double-check
                    </span>
                  )}
                </p>
                {checking && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Checking" />}
              </div>
              {errors.length > 0 && (
                <ul className="space-y-1 text-xs text-decline">
                  {errors.slice(0, 5).map((i) => (
                    <li key={i.field + i.message}>{i.message}</li>
                  ))}
                  {errors.length > 5 && <li>…and {errors.length - 5} more below.</li>}
                </ul>
              )}
              {draft.notes.length > 0 && (
                <div className="rounded-md border border-escalate/30 bg-escalate-soft p-2.5">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-escalate">
                    <TriangleAlert className="size-3.5" aria-hidden /> Notes from the AI
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-foreground/80">
                    {draft.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {draft.source === "ai"
                    ? `Drafted by ${draft.model} · $${(draft.costUsd ?? 0).toFixed(4)}`
                    : "Filled in by hand"}
                </p>
                <Button onClick={save} disabled={errors.length > 0 || busy !== null || checking}>
                  {busy === "save" && <Loader2 className="size-4 animate-spin" />}
                  Save client
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="min-h-0 flex-1 gap-0 py-0">
            <CardHeader className="border-b px-4 py-3">
              <CardTitle className="text-sm font-semibold">Policy text</CardTitle>
            </CardHeader>
            <div ref={textRef} className="max-h-[60vh] overflow-y-auto p-2 lg:max-h-none lg:flex-1">
              {draft.sections.map((s) => (
                <section
                  key={s.section_id}
                  data-section={s.section_id}
                  className={cn(
                    "rounded-md p-2.5 transition-colors",
                    s.section_id === activeSection && "bg-escalate-soft ring-1 ring-escalate/40",
                  )}
                >
                  <h3 className="text-xs font-medium">
                    <span className="mr-1.5 font-mono text-muted-foreground">{s.section_id}</span>
                    {s.heading}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-foreground/80">{s.text}</p>
                </section>
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div>
      <Link href="/policies" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Policies
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Onboard a new client</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Paste the client&apos;s maintenance policy. The AI drafts the settings our rule checks use and
        links each one to the section that states it. You review the draft, fix anything flagged
        and add the client&apos;s vehicles. Nothing is saved until you click Save.
      </p>
    </div>
  );
}
