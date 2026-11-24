"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORIES, categoryLabel } from "@/lib/format";
import type { ClientPolicy, Issue, PolicyChunk, RuleAction, Shop } from "@/lib/types";
import {
  ChipSelect,
  FieldShell,
  IssueList,
  NumberInput,
  SECTION_KEYS,
  SourceChip,
  categoryOptions,
} from "./fields";

interface Props {
  policy: ClientPolicy;
  onChange: (patch: Partial<ClientPolicy>) => void;
  issues: Issue[];
  sections: PolicyChunk[];
  shops: Shop[];
  vehiclesCsv: string;
  onVehiclesCsv: (v: string) => void;
  vehicleCount: number;
  onShowSection: (sectionId: string) => void;
}

const NONE = "__none";

function ActionSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: RuleAction;
  onChange: (v: RuleAction) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as RuleAction)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="escalate">Escalate for review</SelectItem>
        <SelectItem value="block">Decline</SelectItem>
      </SelectContent>
    </Select>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4 px-5">{children}</CardContent>
    </Card>
  );
}

export function SettingsForm({
  policy: p,
  onChange,
  issues,
  sections,
  shops,
  vehiclesCsv,
  onVehiclesCsv,
  vehicleCount,
  onShowSection,
}: Props) {
  const at = (field: string) => issues.filter((i) => i.field === field);
  const src = (key: string) => <SourceChip sectionId={p.sections[key]} onShow={onShowSection} />;
  const limits = Object.entries(p.category_limits);
  const unusedCats = CATEGORIES.filter((c) => !(c in p.category_limits));

  function setLimit(oldCat: string, cat: string, value: number) {
    const next: Record<string, number> = {};
    for (const [c, v] of limits) {
      if (c === oldCat) next[cat] = value;
      else next[c] = v;
    }
    onChange({ category_limits: next });
  }

  return (
    <div className="space-y-4">
      <Section title="Client">
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <FieldShell id="ob-name" label="Company name" issues={at("name")}>
            <Input id="ob-name" value={p.name} onChange={(e) => onChange({ name: e.target.value })} />
          </FieldShell>
          <FieldShell id="ob-id" label="Client ID" hint="From the section IDs" issues={at("client_id")}>
            <Input id="ob-id" value={p.client_id} readOnly className="font-mono" />
          </FieldShell>
        </div>
        <FieldShell id="ob-summary" label="One-line summary for reviewers" issues={at("summary")}>
          <Textarea
            id="ob-summary"
            rows={2}
            value={p.summary}
            onChange={(e) => onChange({ summary: e.target.value })}
          />
        </FieldShell>
      </Section>

      <Section title="Spending limits">
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldShell
            id="ob-limit"
            label="Approval limit"
            hint="Requests at or under this total can be approved."
            source={src("auto_approve")}
            issues={at("auto_approve_limit")}
          >
            <NumberInput
              id="ob-limit"
              prefix="$"
              value={p.auto_approve_limit}
              invalid={at("auto_approve_limit").some((i) => i.level === "error")}
              onChange={(v) => onChange({ auto_approve_limit: v ?? 0 })}
            />
          </FieldShell>
          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <FieldShell
              id="ob-labour"
              label="Labour-rate cap"
              source={src("labor_cap")}
              issues={at("labor_rate_cap")}
            >
              <NumberInput
                id="ob-labour"
                prefix="$"
                suffix="/hr"
                value={p.labor_rate_cap}
                onChange={(v) => onChange({ labor_rate_cap: v ?? 0 })}
              />
            </FieldShell>
            <FieldShell id="ob-labour-action" label="If exceeded" issues={[]}>
              <ActionSelect
                id="ob-labour-action"
                value={p.labor_cap_action}
                onChange={(v) => onChange({ labor_cap_action: v })}
              />
            </FieldShell>
          </div>
        </div>

        <FieldShell
          label="Category limits"
          hint="Categories with their own limit, replacing the approval limit."
          source={src("category_limit")}
          issues={at("category_limits")}
        >
          <div className="space-y-2">
            {limits.map(([cat, value]) => (
              <div key={cat} className="flex items-center gap-2">
                <Select value={cat} onValueChange={(c) => setLimit(cat, c, value)}>
                  <SelectTrigger className="w-48" aria-label="Category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[cat, ...unusedCats].map((c) => (
                      <SelectItem key={c} value={c}>
                        {categoryLabel(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="w-36">
                  <NumberInput
                    id={`ob-cat-${cat}`}
                    prefix="$"
                    value={value}
                    onChange={(v) => setLimit(cat, cat, v ?? 0)}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${categoryLabel(cat)} limit`}
                  onClick={() => {
                    const next = { ...p.category_limits };
                    delete next[cat];
                    onChange({ category_limits: next });
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            {unusedCats.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onChange({
                    category_limits: { ...p.category_limits, [unusedCats[0]]: p.auto_approve_limit },
                  })
                }
              >
                <Plus className="size-4" /> Add category limit
              </Button>
            )}
          </div>
        </FieldShell>

        <div className="grid gap-4 sm:grid-cols-3">
          <FieldShell
            id="ob-qt"
            label="Quotes needed above"
            source={src("quotes")}
            issues={at("quote_threshold")}
          >
            <NumberInput
              id="ob-qt"
              prefix="$"
              value={p.quote_threshold}
              onChange={(v) => onChange({ quote_threshold: v })}
            />
          </FieldShell>
          <FieldShell id="ob-qn" label="Number of quotes" issues={at("quotes_required")}>
            <NumberInput
              id="ob-qn"
              step="1"
              value={p.quote_threshold == null ? null : p.quotes_required}
              onChange={(v) => onChange({ quotes_required: v ?? 0 })}
            />
          </FieldShell>
          <FieldShell id="ob-ql" label="Limit with quotes" issues={at("limit_with_quotes")}>
            <NumberInput
              id="ob-ql"
              prefix="$"
              value={p.limit_with_quotes}
              onChange={(v) => onChange({ limit_with_quotes: v })}
            />
          </FieldShell>
        </div>
      </Section>

      <Section title="Vendors">
        <FieldShell
          label="Approved vendors"
          source={src("vendor")}
          issues={at("approved_vendors")}
        >
          <ChipSelect
            label="Approved vendors"
            options={shops.map((s) => ({ value: s.shop_id, label: `${s.name} · ${s.city}` }))}
            selected={p.approved_vendors}
            onChange={(v) => onChange({ approved_vendors: v })}
          />
        </FieldShell>
        <div className="max-w-xs">
          <FieldShell id="ob-vendor-action" label="Work at other vendors" issues={[]}>
            <ActionSelect
              id="ob-vendor-action"
              value={p.non_approved_vendor_action}
              onChange={(v) => onChange({ non_approved_vendor_action: v })}
            />
          </FieldShell>
        </div>
      </Section>

      <Section title="Work rules" description="Click a category to add or remove it.">
        <FieldShell
          label="Needs pre-approval (escalate)"
          source={src("pre_approval")}
          issues={at("pre_approval_categories")}
        >
          <ChipSelect
            label="Needs pre-approval"
            tone="escalate"
            options={categoryOptions(CATEGORIES)}
            selected={p.pre_approval_categories}
            onChange={(v) => onChange({ pre_approval_categories: v })}
          />
        </FieldShell>
        <FieldShell
          label="Always escalate to a specialist"
          source={src("always_escalate")}
          issues={at("always_escalate_categories")}
        >
          <ChipSelect
            label="Always escalate"
            tone="escalate"
            options={categoryOptions(CATEGORIES)}
            selected={p.always_escalate_categories}
            onChange={(v) => onChange({ always_escalate_categories: v })}
          />
        </FieldShell>
        <FieldShell
          label="Excluded (decline)"
          source={src("exclusion")}
          issues={at("excluded_categories")}
        >
          <ChipSelect
            label="Excluded"
            tone="decline"
            options={categoryOptions(CATEGORIES)}
            selected={p.excluded_categories}
            onChange={(v) => onChange({ excluded_categories: v })}
          />
        </FieldShell>
      </Section>

      <Section title="Maintenance and parts">
        <div className="grid gap-4 sm:grid-cols-3">
          <FieldShell
            id="ob-pm"
            label="Service interval"
            source={src("pm_interval")}
            issues={at("pm_interval_miles")}
          >
            <NumberInput
              id="ob-pm"
              suffix="mi"
              step="1"
              value={p.pm_interval_miles}
              onChange={(v) => onChange({ pm_interval_miles: v })}
            />
          </FieldShell>
          <FieldShell
            id="ob-pm-min"
            label="Decline service before"
            source={src("pm_early")}
            issues={at("pm_min_miles")}
          >
            <NumberInput
              id="ob-pm-min"
              suffix="mi"
              step="1"
              value={p.pm_min_miles}
              onChange={(v) => onChange({ pm_min_miles: v })}
            />
          </FieldShell>
          <FieldShell
            id="ob-markup"
            label="Review parts priced over"
            source={src("parts_markup")}
            issues={at("parts_markup_review_pct")}
          >
            <NumberInput
              id="ob-markup"
              suffix="% ref"
              value={p.parts_markup_review_pct}
              onChange={(v) => onChange({ parts_markup_review_pct: v })}
            />
          </FieldShell>
        </div>
      </Section>

      <Section
        title="Policy sections"
        description="The section each rule cites when it flags a request. Reviewers see these quotes."
      >
        <div className="divide-y rounded-md border">
          {SECTION_KEYS.map(({ key, label, always }) => {
            const value = p.sections[key];
            const keyIssues = at(`sections.${key}`);
            return (
              <div key={key} className="grid items-start gap-2 px-3 py-2 sm:grid-cols-[1fr_220px]">
                <div className="pt-1.5 text-sm">
                  {label}
                  {always && <span className="ml-1.5 text-xs text-muted-foreground">required</span>}
                  <IssueList issues={keyIssues} />
                </div>
                <Select
                  value={value ?? NONE}
                  onValueChange={(v) => {
                    const next = { ...p.sections };
                    if (v === NONE) delete next[key];
                    else next[key] = v;
                    onChange({ sections: next });
                  }}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label={`Section for ${label}`}
                    aria-invalid={keyIssues.some((i) => i.level === "error") || undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not covered</SelectItem>
                    {sections.map((s) => (
                      <SelectItem key={s.section_id} value={s.section_id}>
                        <span className="font-mono text-xs">{s.section_id}</span> {s.heading}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title="Fleet"
        description="Paste the client's vehicle list as CSV. Warranty terms default to 36 mo / 36k mi basic, plus 60 mo / 100k mi powertrain (ICE) or 96 mo / 100k mi battery (EV); add warranty columns to override."
      >
        <FieldShell
          id="ob-fleet"
          label={`Vehicles${vehicleCount ? ` (${vehicleCount})` : ""}`}
          issues={at("vehicles")}
        >
          <Textarea
            id="ob-fleet"
            rows={6}
            value={vehiclesCsv}
            onChange={(e) => onVehiclesCsv(e.target.value)}
            className="font-mono text-xs"
            spellCheck={false}
          />
        </FieldShell>
      </Section>
    </div>
  );
}
