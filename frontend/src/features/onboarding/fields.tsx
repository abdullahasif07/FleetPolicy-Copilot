"use client";

import { AlertTriangle, CircleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { categoryLabel } from "@/lib/format";
import type { Issue } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Policy "slots" the rule engine cites. Mirrors backend app/onboarding/checks.py. */
export const SECTION_KEYS: { key: string; label: string; always?: boolean }[] = [
  { key: "auto_approve", label: "Standard approval limit", always: true },
  { key: "over_limit", label: "Requests above the limit", always: true },
  { key: "category_limit", label: "Higher limits for some categories" },
  { key: "quotes", label: "Competing quotes" },
  { key: "pre_approval", label: "Work needing pre-approval" },
  { key: "always_escalate", label: "Work that is always escalated" },
  { key: "warranty", label: "Warranty handling", always: true },
  { key: "warranty_battery", label: "EV battery warranty" },
  { key: "vendor", label: "Non-approved vendors", always: true },
  { key: "labor_cap", label: "Labour-rate cap", always: true },
  { key: "parts_markup", label: "Parts price review" },
  { key: "pm_interval", label: "Service interval", always: true },
  { key: "pm_early", label: "Early preventive maintenance" },
  { key: "exclusion", label: "Excluded work" },
  { key: "missing_info", label: "Missing information", always: true },
];

export function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="mt-1.5 space-y-1">
      {issues.map((i) => (
        <li
          key={i.message}
          className={cn(
            "flex gap-1.5 text-xs",
            i.level === "error" ? "text-decline" : "text-escalate",
          )}
        >
          {i.level === "error" ? (
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          ) : (
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          )}
          <span>{i.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** Small chip showing which policy section a setting came from; click to show it. */
export function SourceChip({
  sectionId,
  onShow,
}: {
  sectionId: string | undefined;
  onShow: (sectionId: string) => void;
}) {
  if (!sectionId) return null;
  return (
    <button
      type="button"
      onClick={() => onShow(sectionId)}
      className="rounded border bg-muted/50 px-1.5 py-px font-mono text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
      title="Show this section of the policy"
    >
      {sectionId}
    </button>
  );
}

export function FieldShell({
  id,
  label,
  hint,
  source,
  issues,
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  source?: React.ReactNode;
  issues: Issue[];
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {source}
      </div>
      {children}
      {hint && !issues.length && <p className="text-xs text-muted-foreground">{hint}</p>}
      <IssueList issues={issues} />
    </div>
  );
}

const toNumber = (s: string) => (s.trim() === "" ? null : Number(s));

export function NumberInput({
  id,
  value,
  onChange,
  prefix,
  suffix,
  invalid,
  step = "any",
}: {
  id: string;
  value: number | null;
  onChange: (v: number | null) => void;
  prefix?: string;
  suffix?: string;
  invalid?: boolean;
  step?: string;
}) {
  return (
    <div className="relative">
      {prefix && (
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
          {prefix}
        </span>
      )}
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        value={value ?? ""}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(toNumber(e.target.value))}
        className={cn("tabular-nums", prefix && "pl-6", suffix && "pr-12")}
        placeholder="Not set"
      />
      {suffix && (
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  );
}

/** Toggle-chip multi-select (categories, vendors). */
export function ChipSelect({
  label,
  options,
  selected,
  onChange,
  tone = "default",
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  tone?: "default" | "decline" | "escalate";
}) {
  const on = new Set(selected);
  const toneOn = {
    default: "border-primary/50 bg-primary/10 text-foreground",
    escalate: "border-escalate/50 bg-escalate-soft text-foreground",
    decline: "border-decline/50 bg-decline-soft text-foreground",
  }[tone];
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = on.has(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() =>
              onChange(active ? selected.filter((s) => s !== o.value) : [...selected, o.value])
            }
            className={cn(
              "rounded-md border px-2 py-1 text-xs transition-colors",
              active ? toneOn : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export const categoryOptions = (cats: string[]) =>
  cats.map((c) => ({ value: c, label: categoryLabel(c) }));
