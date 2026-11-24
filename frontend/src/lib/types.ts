// Mirrors the FastAPI response models (backend/app/api/schemas.py, app/agent/schemas.py).

export type Decision = "APPROVE" | "ESCALATE" | "DECLINE";
export type RequestStatus = "pending" | "analyzed" | "decided";
export type Severity = "block" | "escalate" | "info";

export interface RequestSummary {
  request_id: string;
  client_id: string;
  client_name: string;
  vehicle_id: string;
  vehicle_label: string;
  unit_number: string | null;
  shop_id: string;
  shop_name: string;
  total: number | null;
  submitted_at: string;
  status: RequestStatus;
  ai_decision: Decision | null;
  human_action: Decision | null;
  injection_flag: boolean;
  line_item_count: number;
  headline: string;
  is_custom: boolean;
}

export interface LineItem {
  description: string;
  category: string | null;
  part_code: string | null;
  quantity: number;
  part_cost: number | null;
  labor_hours: number | null;
  labor_rate: number | null;
}

export interface RepairRequest {
  request_id: string;
  client_id: string;
  vehicle_id: string;
  shop_id: string;
  submitted_at: string;
  odometer: number | null;
  quotes_count: number | null;
  line_items: LineItem[];
  shop_notes: string;
}

export interface Vehicle {
  vehicle_id: string;
  client_id: string;
  unit_number: string;
  make: string;
  model: string;
  year: number;
  powertrain: "ICE" | "EV" | string;
  mileage: number;
  in_service_date: string;
  last_pm_mileage: number | null;
}

export interface WarrantyStatus {
  name: string;
  active: boolean;
  months_limit: number;
  miles_limit: number;
  months_elapsed: number;
  odometer: number | null;
  covers: string[];
}

export interface Shop {
  shop_id: string;
  name: string;
  city: string;
}

export interface ClientInfo {
  client_id: string;
  name: string;
  summary: string;
  auto_approve_limit: number;
  category_limits: Record<string, number>;
  quote_threshold: number | null;
  quotes_required: number;
  labor_rate_cap: number;
  approved_vendors: Shop[];
  pre_approval_categories: string[];
  always_escalate_categories: string[];
  excluded_categories: string[];
  pm_interval_miles: number | null;
  onboarded: boolean;
}

export type RuleAction = "block" | "escalate";

/** Full structured settings for a client (what the rule engine checks). */
export interface ClientPolicy {
  client_id: string;
  name: string;
  policy_file: string;
  summary: string;
  auto_approve_limit: number;
  category_limits: Record<string, number>;
  quote_threshold: number | null;
  quotes_required: number;
  limit_with_quotes: number | null;
  approved_vendors: string[];
  non_approved_vendor_action: RuleAction;
  labor_rate_cap: number;
  labor_cap_action: RuleAction;
  pre_approval_categories: string[];
  always_escalate_categories: string[];
  excluded_categories: string[];
  pm_interval_miles: number | null;
  pm_min_miles: number | null;
  parts_markup_review_pct: number | null;
  sections: Record<string, string>;
}

export interface Issue {
  field: string;
  level: "error" | "warning";
  message: string;
}

export interface ParsedPolicy {
  client_id: string;
  sections: PolicyChunk[];
}

export interface PolicyDraft extends ParsedPolicy {
  policy: ClientPolicy;
  notes: string[];
  issues: Issue[];
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
}

export interface OnboardCheck {
  client_id: string | null;
  issues: Issue[];
  vehicle_count: number;
}

export interface RuleFlag {
  rule: string;
  severity: Severity;
  message: string;
  section_id: string;
  line_index: number | null;
}

export interface Reason {
  text: string;
  citation_section_id: string;
  quoted_clause: string;
  verified: boolean;
  source: "llm" | "rule";
}

export interface Recommendation {
  decision: Decision;
  confidence: number;
  summary: string;
  reasons: Reason[];
  rule_flags: RuleFlag[];
  warranty_opportunity: boolean;
  estimated_savings: number;
  injection_detected: boolean;
  injection_signals: string[];
  llm_decision: Decision | null;
  decision_floor: Decision;
  overridden_by_rules: boolean;
  validation_notes: string[];
}

export interface TraceMeta {
  run_id: string;
  model: string | null;
  fallback_used: boolean;
  latency_ms: number;
  step_latency_ms: Record<string, number>;
  tokens_in: number;
  tokens_out: number;
  embedding_tokens: number;
  cost_usd: number;
  retrieved_sections: string[];
  error: string | null;
}

export interface PolicyChunk {
  chunk_id: string;
  client_id: string;
  section_id: string;
  heading: string;
  part: string;
  text: string;
}

export interface RetrievedChunk {
  chunk: PolicyChunk;
  score: number;
  bm25_rank: number | null;
  vector_rank: number | null;
  source: "search" | "rule";
}

export interface AnalysisResult {
  request_id: string;
  recommendation: Recommendation;
  trace: TraceMeta;
  retrieved: RetrievedChunk[];
}

export interface DecisionOut {
  ai_decision: Decision;
  human_action: Decision;
  is_override: boolean;
  override_reason: string | null;
  decided_at: string;
}

export interface RequestDetail {
  summary: RequestSummary;
  request: RepairRequest;
  vehicle: Vehicle | null;
  warranty: WarrantyStatus[];
  client: ClientInfo;
  shop: Shop | null;
  shop_is_approved: boolean;
  injection_signals: string[];
  analysis: AnalysisResult | null;
  decision: DecisionOut | null;
  what_if: WhatIfResult;
}

/** One deterministic "what if": the rule checks re-run with a single change. */
export interface WhatIf {
  rule: string;
  section_id: string;
  change: string;
  fixable: boolean;
  decision_after: Decision | null;
  note: string | null;
}

export interface WhatIfResult {
  current_floor: Decision;
  items: WhatIf[];
  all_changes_floor: Decision | null;
}

export interface PolicyDoc {
  client_id: string;
  name: string;
  markdown: string;
  sections: PolicyChunk[];
}

export interface Health {
  status: string;
  llm_configured: boolean;
  model: string;
  fallback_model: string;
  embedding_model: string;
  tracing: boolean;
}

export interface StepEvent {
  event: "step";
  node: string;
  label: string;
  status: "running" | "done";
  ms?: number | null;
}

export interface UsageMetrics {
  total_requests: number;
  analyzed_requests: number;
  analysis_runs: number;
  decided_requests: number;
  agreement_rate: number | null;
  override_count: number;
  override_pairs: Record<string, number>;
  escalation_rate: number | null;
  ai_decision_mix: Partial<Record<Decision, number>>;
  human_decision_mix: Partial<Record<Decision, number>>;
  avg_latency_ms: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  avg_cost_usd: number | null;
  total_cost_usd: number;
  spend_today_usd: number;
  daily_spend_cap_usd: number;
  injections_flagged: number;
  rule_overrides_of_ai: number;
}

export interface EvalItem {
  request_id: string;
  tags: string[];
  expected_decision: Decision;
  decision: Decision;
  decision_correct: boolean;
  citation_correct: boolean;
  cited_section_ids: string[];
  latency_ms: number;
  cost_usd: number;
  is_injection: boolean;
}

export interface EvalResults {
  generated_at: string;
  mode: "live" | "offline";
  models: { llm: string; fallback: string | null; embedding: string };
  metrics: {
    n: number;
    decision_accuracy: number | null;
    citation_accuracy: number | null;
    escalation_rate: number;
    expected_escalation_rate: number;
    injection_resistance: number | null;
    injection_detection: number | null;
    uncited_final_decisions: number;
    warranty_recall: number | null;
    llm_only_accuracy: number | null;
    rules_only_accuracy: number | null;
    p50_latency_ms: number | null;
    p95_latency_ms: number | null;
    avg_cost_usd: number;
    total_cost_usd: number;
    errors: number;
  };
  confusion_matrix: Record<string, Record<string, number>>;
  by_tag: Record<string, { n: number; decision_accuracy: number | null }>;
  items: EvalItem[];
}

export interface Metrics {
  usage: UsageMetrics;
  evals: EvalResults | null;
}

export interface AuditEntry {
  request_id: string;
  client_name: string;
  total: number | null;
  ai_decision: Decision;
  ai_confidence: number;
  human_action: Decision;
  is_override: boolean;
  override_reason: string | null;
  decided_at: string;
  model: string | null;
  cost_usd: number;
  injection_detected: boolean;
}
