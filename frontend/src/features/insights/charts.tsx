"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DECISION_LABEL } from "@/lib/format";
import type { Decision } from "@/lib/types";
import { cn } from "@/lib/utils";

export const pct = (x: number | null | undefined, digits = 0) =>
  x == null ? "—" : `${(x * 100).toFixed(digits)}%`;

// Chart fills use the validated --chart-* tokens (not the text tokens).
export const DECISION_FILL: Record<Decision, string> = {
  APPROVE: "bg-chart-approve",
  ESCALATE: "bg-chart-escalate",
  DECLINE: "bg-chart-decline",
};
// Label ink inside each fill: near-black on the light amber fill, white elsewhere.
const FILL_INK: Record<Decision, string> = {
  APPROVE: "text-white",
  ESCALATE: "text-neutral-950",
  DECLINE: "text-white",
};
const ORDER: Decision[] = ["APPROVE", "ESCALATE", "DECLINE"];

// --- Stat tile ----------------------------------------------------------------------------

export function StatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

// --- Meter list -------------------------------------------------------------------------

export interface MeterRow {
  label: string;
  value: number | null; // 0..1
  target?: number;
  note?: string;
}

export function MeterList({ rows, ariaLabel }: { rows: MeterRow[]; ariaLabel: string }) {
  return (
    <ul aria-label={ariaLabel} className="space-y-3">
      {rows.map((r) => {
        const v = r.value ?? 0;
        const met = r.target == null || (r.value != null && r.value >= r.target);
        return (
          <li key={r.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[180px_minmax(0,1fr)_64px]">
            <span className="truncate text-sm">
              {r.label}
              {r.note && <span className="ml-1 text-xs text-muted-foreground">{r.note}</span>}
            </span>
            <span className="text-right text-sm font-semibold tabular-nums sm:order-last">
              {pct(r.value, v < 1 && v > 0.99 ? 1 : 0)}
            </span>
            <div
              className="relative col-span-2 h-2 rounded-full bg-primary/15 sm:col-span-1"
              role="meter"
              aria-label={r.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(v * 100)}
              aria-valuetext={`${pct(r.value)}${r.target != null ? `, target ${pct(r.target)}` : ""}`}
            >
              <div
                className={cn("h-full rounded-full", met ? "bg-primary" : "bg-chart-decline")}
                style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }}
              />
              {r.target != null && (
                <span
                  className="absolute -top-1 h-4 w-0.5 rounded-full bg-foreground/70"
                  style={{ left: `calc(${r.target * 100}% - 1px)` }}
                  title={`Target ${pct(r.target)}`}
                  aria-hidden
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// --- Tall segmented bars (decision mix) ---------------------------------------------------

export function DecisionMixBars({
  rows,
}: {
  rows: { label: string; mix: Partial<Record<Decision, number>> }[];
}) {
  return (
    <div className="space-y-4">
      <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Legend">
        {ORDER.map((d) => (
          <li key={d} className="flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-sm", DECISION_FILL[d])} aria-hidden />
            {DECISION_LABEL[d]}
          </li>
        ))}
      </ul>
      {rows.map((row) => {
        const total = ORDER.reduce((s, d) => s + (row.mix[d] ?? 0), 0);
        return (
          <div key={row.label}>
            <div className="flex justify-between text-sm">
              <span>{row.label}</span>
              <span className="text-muted-foreground tabular-nums">{total}</span>
            </div>
            {total === 0 ? (
              <div className="mt-1.5 flex h-7 items-center rounded bg-muted px-2 text-xs text-muted-foreground">
                No data yet
              </div>
            ) : (
              <div
                className="mt-1.5 flex h-7 gap-0.5"
                role="img"
                aria-label={`${row.label}: ${ORDER.map((d) => `${DECISION_LABEL[d]} ${row.mix[d] ?? 0}`).join(", ")}`}
              >
                {ORDER.filter((d) => (row.mix[d] ?? 0) > 0).map((d) => {
                  const n = row.mix[d] ?? 0;
                  const share = n / total;
                  return (
                    <Tooltip key={d}>
                      <TooltipTrigger asChild>
                        <div
                          tabIndex={0}
                          className={cn(
                            "flex min-w-1 items-center rounded px-2 text-xs font-medium outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring",
                            DECISION_FILL[d],
                            FILL_INK[d],
                          )}
                          style={{ width: `${share * 100}%` }}
                        >
                          {share >= 0.12 && <span className="tabular-nums">{Math.round(share * 100)}%</span>}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <span className="font-semibold tabular-nums">{n}</span> {DECISION_LABEL[d]} ·{" "}
                        {Math.round(share * 100)}%
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Histogram ----------------------------------------------------------------------------

export function Histogram({
  values,
  binSize,
  unit,
  format,
  ariaLabel,
}: {
  values: number[];
  binSize: number;
  unit: string;
  format: (v: number) => string;
  ariaLabel: string;
}) {
  if (!values.length) return null;
  const max = Math.max(...values);
  const nBins = Math.max(1, Math.ceil((max + 1e-9) / binSize));
  const bins = Array.from({ length: nBins }, (_, i) => ({
    from: i * binSize,
    to: (i + 1) * binSize,
    count: values.filter((v) => v >= i * binSize && v < (i + 1) * binSize).length,
  }));
  const top = Math.max(...bins.map((b) => b.count));
  const ticks = [0, Math.ceil(top / 2), top];

  return (
    <figure aria-label={ariaLabel}>
      <div className="flex gap-2">
        <div className="flex h-40 flex-col justify-between pb-0 text-right text-[11px] text-muted-foreground tabular-nums">
          {[...ticks].reverse().map((t) => (
            <span key={t} className="leading-none">
              {t}
            </span>
          ))}
        </div>
        <div className="relative h-40 flex-1">
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute inset-x-0 border-t border-border"
              style={{ bottom: `${(t / top) * 100}%` }}
              aria-hidden
            />
          ))}
          <div className="absolute inset-0 flex items-end gap-0.5">
            {bins.map((b) => (
              <Tooltip key={b.from}>
                <TooltipTrigger asChild>
                  <div
                    tabIndex={0}
                    className="group flex h-full flex-1 items-end justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`${format(b.from)}–${format(b.to)} ${unit}: ${b.count}`}
                  >
                    <div
                      className="w-full max-w-6 rounded-t bg-primary transition-opacity group-hover:opacity-80"
                      style={{ height: `${(b.count / top) * 100}%` }}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <span className="font-semibold tabular-nums">{b.count}</span> requests ·{" "}
                  {format(b.from)}–{format(b.to)} {unit}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-1 flex justify-between pl-6 text-[11px] text-muted-foreground tabular-nums">
        <span>0</span>
        <span>
          {format(nBins * binSize)} {unit}
        </span>
      </div>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
        <table className="mt-2 w-full max-w-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Range ({unit})</th>
              <th className="py-1 text-right font-medium">Requests</th>
            </tr>
          </thead>
          <tbody>
            {bins.map((b) => (
              <tr key={b.from} className="border-t">
                <td className="py-1 tabular-nums">
                  {format(b.from)}–{format(b.to)}
                </td>
                <td className="py-1 text-right tabular-nums">{b.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

// --- Confusion matrix (heat table, one hue) -----------------------------------------------

export function ConfusionMatrix({ matrix }: { matrix: Record<string, Record<string, number>> }) {
  const max = Math.max(1, ...ORDER.flatMap((e) => ORDER.map((g) => matrix[e]?.[g] ?? 0)));
  return (
    <table className="w-full text-sm" aria-label="Confusion matrix: expected decision by row, system decision by column">
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th className="p-1.5 text-left font-medium">Expected ↓ / Got →</th>
          {ORDER.map((d) => (
            <th key={d} className="p-1.5 font-medium">
              {DECISION_LABEL[d]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ORDER.map((exp) => (
          <tr key={exp}>
            <th scope="row" className="p-1.5 text-left text-xs font-medium text-muted-foreground">
              {DECISION_LABEL[exp]}
            </th>
            {ORDER.map((got) => {
              const n = matrix[exp]?.[got] ?? 0;
              const strength = n / max;
              return (
                <td key={got} className="p-0.5">
                  <div
                    className={cn(
                      "flex h-10 items-center justify-center rounded font-semibold tabular-nums",
                      strength > 0.5 ? "text-primary-foreground" : "text-foreground",
                      n === 0 && "text-muted-foreground",
                    )}
                    style={{
                      background:
                        n === 0
                          ? "var(--muted)"
                          : `color-mix(in oklch, var(--primary) ${Math.round(15 + strength * 85)}%, var(--card))`,
                    }}
                    title={`Expected ${DECISION_LABEL[exp]}, got ${DECISION_LABEL[got]}: ${n}`}
                  >
                    {n}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
