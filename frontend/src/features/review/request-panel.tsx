"use client";

import Link from "next/link";
import { BatteryCharging, BookOpen, Building2, Car, Fuel, ShieldAlert, Wrench } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { categoryLabel, miles, money, moneyWhole, shortDate } from "@/lib/format";
import type { RequestDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

function SectionTitle({ icon: Icon, children }: { icon: typeof Car; children: React.ReactNode }) {
  return (
    <CardTitle className="flex items-center gap-2 text-sm font-semibold">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      {children}
    </CardTitle>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

export function RequestPanel({ detail }: { detail: RequestDetail }) {
  const { request, vehicle, warranty, client, shop, shop_is_approved, injection_signals } = detail;
  const total = detail.summary.total;

  return (
    <div className="space-y-4">
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <SectionTitle icon={Wrench}>Work requested</SectionTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">Item</th>
                  <th className="px-2 py-2 text-right font-medium">Parts</th>
                  <th className="px-2 py-2 text-right font-medium">Labour</th>
                  <th className="px-4 py-2 text-right font-medium">Line total</th>
                </tr>
              </thead>
              <tbody>
                {request.line_items.map((li, i) => {
                  const lineTotal =
                    li.part_cost != null && li.labor_hours != null && li.labor_rate != null
                      ? li.part_cost + li.labor_hours * li.labor_rate
                      : null;
                  const overCap = li.labor_rate != null && li.labor_rate > client.labor_rate_cap;
                  return (
                    <tr key={i} className="border-b last:border-0 align-top">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{li.description || "(no description)"}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {categoryLabel(li.category)}
                          {li.part_code && <span className="font-mono"> · {li.part_code}</span>}
                          {li.quantity > 1 && <span> · qty {li.quantity}</span>}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{money(li.part_cost)}</td>
                      <td className="px-2 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {li.labor_hours != null && li.labor_rate != null ? (
                          <>
                            {li.labor_hours}h ×{" "}
                            <span className={cn(overCap && "font-medium text-decline")}>
                              {moneyWhole(li.labor_rate)}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        {money(lineTotal)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/30">
                  <td className="px-4 py-2.5 text-xs text-muted-foreground" colSpan={2}>
                    Odometer {miles(request.odometer)}
                    {request.quotes_count != null && ` · ${request.quotes_count} written quote${request.quotes_count === 1 ? "" : "s"}`}
                  </td>
                  <td className="px-2 py-2.5 text-right text-xs font-medium text-muted-foreground">
                    Total
                  </td>
                  <td className="px-4 py-2.5 text-right text-base font-semibold tabular-nums">
                    {money(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card
        className={cn(
          "gap-2 py-4",
          injection_signals.length > 0 && "border-decline/40 ring-1 ring-decline/20",
        )}
      >
        <CardHeader className="flex flex-row items-center justify-between px-4">
          <SectionTitle icon={Building2}>Shop notes</SectionTitle>
          <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Untrusted input
          </span>
        </CardHeader>
        <CardContent className="space-y-3 px-4">
          {injection_signals.length > 0 && (
            <div
              role="alert"
              className="flex gap-2 rounded-md border border-decline/30 bg-decline-soft p-2.5 text-sm"
            >
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-decline" aria-hidden />
              <div>
                <p className="font-medium text-decline">Possible prompt-injection attempt</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Signals: {injection_signals.join(", ")}. The AI treats shop notes as data and
                  never follows instructions in them; rule checks ignore them entirely.
                </p>
              </div>
            </div>
          )}
          <blockquote className="border-l-2 pl-3 text-sm whitespace-pre-wrap text-foreground/90">
            {request.shop_notes || <span className="text-muted-foreground">No notes.</span>}
          </blockquote>
          <p className="text-xs text-muted-foreground">
            {shop ? `${shop.name}, ${shop.city}` : request.shop_id} ·{" "}
            <span className={shop_is_approved ? "text-approve" : "font-medium text-decline"}>
              {shop_is_approved ? "Approved vendor" : "Not an approved vendor"}
            </span>
          </p>
        </CardContent>
      </Card>

      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <SectionTitle icon={vehicle?.powertrain === "EV" ? BatteryCharging : Car}>Vehicle</SectionTitle>
        </CardHeader>
        <CardContent className="px-4">
          {vehicle ? (
            <>
              <p className="font-medium">
                {vehicle.year} {vehicle.make} {vehicle.model}
                <span className="ml-2 font-mono text-xs text-muted-foreground">{vehicle.unit_number}</span>
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <Field label="Odometer">{miles(request.odometer ?? vehicle.mileage)}</Field>
                <Field label="In service">{shortDate(vehicle.in_service_date)}</Field>
                <Field label="Last PM">{miles(vehicle.last_pm_mileage)}</Field>
                <Field label="Powertrain">
                  <span className="inline-flex items-center gap-1">
                    {vehicle.powertrain === "EV" ? (
                      <BatteryCharging className="size-3.5" aria-hidden />
                    ) : (
                      <Fuel className="size-3.5" aria-hidden />
                    )}
                    {vehicle.powertrain === "EV" ? "Electric" : "Combustion"}
                  </span>
                </Field>
              </dl>
              <div className="mt-4">
                <p className="text-xs text-muted-foreground">Warranty</p>
                <ul className="mt-1.5 flex flex-wrap gap-2">
                  {warranty.map((w) => (
                    <li
                      key={w.name}
                      className={cn(
                        "rounded-md border px-2 py-1 text-xs",
                        w.active
                          ? "border-approve/30 bg-approve-soft text-approve"
                          : "text-muted-foreground",
                      )}
                      title={`Covers: ${w.covers.map(categoryLabel).join(", ")}`}
                    >
                      <span className="font-medium">{w.name}</span> ·{" "}
                      {w.active ? "Active" : "Expired"} ({w.months_limit} mo /{" "}
                      {(w.miles_limit / 1000).toFixed(0)}k mi)
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <p className="text-sm text-decline">Vehicle {request.vehicle_id} was not found in the fleet records.</p>
          )}
        </CardContent>
      </Card>

      <Card className="gap-3 py-4">
        <CardHeader className="flex flex-row items-center justify-between px-4">
          <SectionTitle icon={BookOpen}>{client.name} policy</SectionTitle>
          <Link
            href={`/policies/${client.client_id}`}
            className="text-xs text-primary hover:underline"
          >
            Read full policy
          </Link>
        </CardHeader>
        <CardContent className="px-4">
          <p className="text-sm text-muted-foreground">{client.summary}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Field label="Auto-approval limit">{moneyWhole(client.auto_approve_limit)}</Field>
            <Field label="Labour-rate cap">{moneyWhole(client.labor_rate_cap)}/hr</Field>
            {client.quote_threshold != null && (
              <Field label="Quotes">
                {client.quotes_required} over {moneyWhole(client.quote_threshold)}
              </Field>
            )}
            {Object.entries(client.category_limits).length > 0 && (
              <Field label="Safety-item limit">
                {moneyWhole(Math.max(...Object.values(client.category_limits)))}
              </Field>
            )}
            {client.pm_interval_miles && (
              <Field label="PM interval">{miles(client.pm_interval_miles)}</Field>
            )}
          </dl>
          <div className="mt-3 space-y-1.5 text-xs">
            {client.always_escalate_categories.length > 0 && (
              <p>
                <span className="text-muted-foreground">Always escalate: </span>
                {client.always_escalate_categories.map(categoryLabel).join(", ")}
              </p>
            )}
            <p>
              <span className="text-muted-foreground">Pre-approval: </span>
              {client.pre_approval_categories.map(categoryLabel).join(", ")}
            </p>
            <p>
              <span className="text-muted-foreground">Excluded: </span>
              {client.excluded_categories.map(categoryLabel).join(", ")}
            </p>
            <p>
              <span className="text-muted-foreground">Approved vendors: </span>
              {client.approved_vendors.map((v) => v.name).join(", ")}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
