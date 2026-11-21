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
