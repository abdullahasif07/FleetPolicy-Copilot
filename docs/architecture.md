# Architecture notes

## Request lifecycle

```mermaid
sequenceDiagram
    participant U as Associate (browser)
    participant W as Next.js
    participant A as FastAPI
    participant G as LangGraph
    participant L as OpenAI
    participant D as SQLite
    U->>W: open /requests/R-1010
    W->>A: GET /requests/R-1010
    A-->>W: request, vehicle, warranty, client policy, injection signals
    U->>W: click Analyze
    W->>A: POST /requests/R-1010/analyze (SSE)
    A->>A: spend cap + per-session rate limit
    A->>G: run graph
    loop each node
        G-->>A: step done (latency)
        A-->>W: event: step
    end
    G->>L: structured-output call (retry, backoff, fallback model)
    L-->>G: Recommendation JSON
    G->>G: validate citations, apply rule override
    A->>D: store analysis (decision, citations, tokens, cost, latency)
    A-->>W: event: result
    U->>W: press A / E / D (reason if overriding)
    W->>A: POST /requests/R-1010/decision
    A->>D: store decision (audit log)
```

## Graph state

| Key | Set by | Contents |
|---|---|---|
| `request`, `injection_signals` | parse_request | Typed request; detector hits on shop notes |
| `vehicle`, `policy`, `shop` | load_context | Records from the fleet data |
| `retrieved` | retrieve_policy, then rule_check | Top-k fused chunks, plus sections pinned by rule findings |
| `rule_result` | rule_check | Flags (block / escalate / info), decision floor, warranty savings |
| `llm`, `llm_error` | reason | Parsed recommendation, token usage, model, fallback flag |
| `recommendation` | validate | Final, validated recommendation shown to the user |
| `step_ms`, `embedding_tokens` | every node | Merged with reducers for trace metadata |

## Decision combination

| Rule floor | LLM says | Final |
|---|---|---|
| DECLINE (any `block` flag) | anything | DECLINE, with the rule's clause cited |
| ESCALATE (any `escalate` flag) | anything | ESCALATE |
| APPROVE | APPROVE or DECLINE with a verified citation | the LLM's decision |
| APPROVE | APPROVE or DECLINE without a verified citation | ESCALATE ("insufficient evidence") |
| APPROVE | ESCALATE | ESCALATE |
| any | LLM unavailable | the rule floor, but never APPROVE (escalated instead) |
