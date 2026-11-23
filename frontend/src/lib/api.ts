import type {
  AnalysisResult,
  Decision,
  DecisionOut,
  LineItem,
  RequestSummary,
  StepEvent,
} from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(
  /\/$/,
  "",
);

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let memorySessionId: string | null = null;

/** Per-browser session ID used by the backend's rate limiter. */
export function getSessionId(): string {
  try {
    const existing = localStorage.getItem("fpc-session");
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem("fpc-session", created);
    return created;
  } catch {
    memorySessionId ??= `mem-${Math.random().toString(36).slice(2, 14)}`;
    return memorySessionId;
  }
}

function headers(extra?: HeadersInit): HeadersInit {
  return { "Content-Type": "application/json", "X-Session-ID": getSessionId(), ...extra };
}

async function toError(res: Response): Promise<ApiError> {
  let message = `Request failed (${res.status})`;
  let code: string | undefined;
  try {
    const body = await res.json();
    if (typeof body.message === "string") message = body.message;
    else if (typeof body.detail === "string") message = body.detail;
    else if (Array.isArray(body.detail)) message = body.detail.map((d: { msg: string }) => d.msg).join("; ");
    code = body.code;
  } catch {
    /* non-JSON body */
  }
  return new ApiError(message, res.status, code);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers: headers(init?.headers) });
  } catch {
    throw new ApiError(`Can't reach the API at ${API_URL}. Is the backend running?`, 0, "network");
  }
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

export const fetcher = <T>(path: string) => request<T>(path);

export function recordDecision(id: string, action: Decision, overrideReason?: string) {
  return request<DecisionOut>(`/requests/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    body: JSON.stringify({ action, override_reason: overrideReason || null }),
  });
}

export interface NewRequest {
  client_id: string;
  vehicle_id: string;
  shop_id: string;
  odometer: number | null;
  quotes_count: number | null;
  line_items: LineItem[];
  shop_notes: string;
}

export function createRequest(body: NewRequest) {
  return request<RequestSummary>("/requests", { method: "POST", body: JSON.stringify(body) });
}

export function resetDemo() {
  return request<{ status: string }>("/demo/reset", { method: "POST" });
}

export type AnalysisEvent =
  | { event: "start"; steps: { node: string; label: string }[] }
  | StepEvent
  | { event: "result"; result: AnalysisResult }
  | { event: "error"; message: string };

/** POST /analyze and parse the Server-Sent Events stream. */
export async function streamAnalysis(
  id: string,
  onEvent: (e: AnalysisEvent) => void,
  signal?: AbortSignal,
): Promise<AnalysisResult> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/requests/${encodeURIComponent(id)}/analyze`, {
      method: "POST",
      headers: headers({ Accept: "text/event-stream" }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(`Can't reach the API at ${API_URL}. Is the backend running?`, 0, "network");
  }
  if (!res.ok || !res.body) throw await toError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: AnalysisResult | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (!data) continue;
      const payload = JSON.parse(data);
      if (event === "start") onEvent({ event: "start", steps: payload.steps });
      else if (event === "step") onEvent(payload as StepEvent);
      else if (event === "result") {
        result = payload as AnalysisResult;
        onEvent({ event: "result", result });
      } else if (event === "error") {
        onEvent({ event: "error", message: payload.message });
        throw new ApiError(payload.message, 500, "analysis_failed");
      }
    }
  }
  if (!result) throw new ApiError("The analysis ended without a result. Please retry.", 500);
  return result;
}
