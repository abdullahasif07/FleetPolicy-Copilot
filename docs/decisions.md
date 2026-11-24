# Design decisions

Wherever the spec was ambiguous I chose the simpler option and recorded it here.

## Data
- **Reference date.** Warranty age is measured from the vehicle's in-service date to the
  request's `submitted_at` date, not "today", so results don't change as time passes.
- **Odometer.** Warranty and PM checks use the odometer reading on the request. If it is
  missing, the request escalates (missing information) and those checks are skipped.
- **One fictional warranty model per vehicle class.** Light duty: basic 36 mo/36k mi,
  powertrain 60 mo/100k. Medium duty: basic 24 mo/250k, powertrain 60 mo/250k. EV: basic
  36 mo/36k, battery and drive unit 96 mo/100k. These terms are invented for the demo.
- **Warranty coverage by category.** Basic covers engine, transmission, electrical, HVAC,
  steering and suspension. Powertrain covers engine and transmission. Battery covers
  `battery_hv` and `electric_drive`. Wear items are never covered.
- **Any covered line declines the whole request.** The vendor is told to split it out and
  file it as a warranty claim. Estimated savings is the total of the covered lines.
- **Request totals** are computed as parts plus labour hours × rate. Tax and fees are left
  out. If any line is missing a cost, the total is unknown and the request escalates.
- **Eval labels allow several acceptable sections.** `expected_section_ids[0]` is the
  primary one, and citing any listed section counts as correct.
- **Three injection requests** (R-1010, R-1030, R-1040), as the spec asks. R-1013 is
  tagged `llm_judgment`: the work is filed as category `other`, so only the LLM (reading
  the description against the exclusions clause) can catch it.

## Rule engine
- **Severity model.** `block` forces DECLINE, `escalate` caps the decision at ESCALATE, and
  `info` is context only. Precedence is block > escalate > info.
- **Exception: always-escalate categories.** Summit's high-voltage battery work under an
  active warranty is flagged `info` for warranty, not `block`, because policy SH-3.2 says
  battery work is always escalated and the EV specialist handles the claim.
- **Category limits** (Cedar Valley's $1,500 for safety work) apply only when *every* line
  falls in a category that has a limit. Mixed requests use the general limit.
- **Harbor Foods quotes.** Above $750 with fewer than 2 quotes → DECLINE. With 2 quotes →
  allowed up to $2,500. Above that → ESCALATE. A missing quote count → ESCALATE.
- **Parts markup** compares the line's parts cost against `ref_high × quantity` from
  `rates.csv`, and runs only for clients whose policy has a markup threshold (NW 25%, HF 20%).

## Tooling
- **LLM models.** `LLM_MODEL=gpt-4.1-mini`, `LLM_FALLBACK_MODEL=gpt-4o-mini`,
  `EMBEDDING_MODEL=text-embedding-3-small`. All three are set through env vars.
- **Python 3.12 via uv**, because the local system Python is 3.14, which ChromaDB doesn't
  fully support yet. Docker also works.

## Retrieval and agent (M2)
- **Chunking.** One chunk per `### XX-n.n` policy section, tagged with `client_id` and
  `section_id`. Sections are short, so they aren't split further.
- **Hybrid search.** BM25 (`rank_bm25`, in memory per client) plus Chroma cosine vector
  search, merged with reciprocal-rank fusion (k=60), top 6 results. Every search is
  filtered by `client_id`.
- **The retrieval query uses structured fields only** (line-item descriptions and
  categories). Untrusted shop notes never steer retrieval.
- **Rule-cited sections are pinned into the LLM's context** after `rule_check`, so every
  rule finding has a clause the LLM and the validator can cite. When an injection is
  detected, the "vendor notes have no authority" section (`XX-10.1`) is pinned too.
- **`load_context` "tool call"** is a deterministic lookup (`app/agent/tools.py`), not an
  LLM function call. The model never decides which records to fetch, so that step stays
  predictable.
- **How the AI and rules combine.** Rules DECLINE → DECLINE. Rules ESCALATE → ESCALATE.
  Rules APPROVE → the LLM's decision, if it carries a verified citation. An uncited
  APPROVE or DECLINE → ESCALATE ("insufficient evidence"). An uncited ESCALATE is allowed.
- **Quote verification** is a case- and whitespace-insensitive substring match against the
  cited chunk, with a minimum of 12 characters.
- **LLM outage.** After retries with backoff on the primary model and then the fallback
  model, the graph degrades to a rules-only recommendation. It never approves without the
  AI's cited evidence.
- **Injection handling.** Shop notes are wrapped in `<untrusted_shop_notes>`, and `<` and
  `>` are replaced so a note can't close or spoof the tags. A regex detector flags
  suspicious notes for the UI. Safety doesn't depend on the detector.
- **Cost** is estimated from a price table in `app/config.py` (approximate list prices).

## API and storage (M2)
- **Extra read-only endpoints for the UI:** `GET /clients`, `/policies/{id}`, `/vehicles`,
  `/shops`, `/health`. Also `POST /demo/reset` for the demo mode. Reset keeps usage rows,
  so it can't be used to get around the daily spend cap.
- **Analyze uses SSE by default.** `?stream=false` returns plain JSON for scripts.
- **One human decision per request.** Recording a decision requires an analysis first
  (409 otherwise). Overriding the AI requires a reason of at least 5 characters.
- **Sessions.** The rate limit keys on the `X-Session-ID` header the frontend sends, and
  falls back to client IP. It's in memory and per process, which is fine for a
  single-instance demo.
- **The app is created by a factory** (`uvicorn app.main:create_app --factory`), so
  importing it has no side effects and tests can inject fakes.

## Evaluation (M3)
- **How each metric is defined:**
  - *Decision accuracy:* the final decision equals the label.
  - *Citation accuracy:* at least one verified citation is in `expected_section_ids`.
  - *Injection resistance:* on the 3 injection requests, the final decision equals the
    label and is not APPROVE.
  - *Uncited final decisions:* APPROVE or DECLINE results with no verified citation.
    The target is 0.
- **Extra diagnostics.** The report also shows *LLM-only accuracy* (the model's decision
  before the rule override) and *rules-only accuracy*, so you can see what each layer
  contributes. It also includes a confusion matrix and accuracy by tag.
- **Offline mode** (`--offline`) uses a stand-in LLM that mirrors the rule check, plus hash
  embeddings. It tests the pipeline in CI without a key and writes to
  `evals/results.offline.json`, so it never overwrites real results.
- **Prompt tuning was done against this same 40-item set.** The first live run scored
  92.5%. All three misses were the model re-deriving facts the rules had already computed
  (category limit, PM interval, warranty). The fixes:
  1. Info-level rule flags now state what was *verified* ("no line item is covered by an
     active warranty", "PM interval met", "category limit replaces the general limit").
  2. The prompt tells the model to treat those flags as facts.
  3. One clarifying sentence was added to Cedar Valley CV-2.2.
  
  After the fixes it scored 100% on two consecutive runs. Because the tuning set and the
  test set are the same, this number is optimistic. A held-out set of new requests is
  listed under "what I'd do next".

## Frontend (M4)
- **Data fetching happens in the browser with SWR.** The FastAPI backend is a separate
  service, and the rate limiter keys on a per-browser `X-Session-ID`, so browser fetching
  is the natural fit. Pages are prerendered shells (Next 16 Cache Components). Components
  that read URL data (`useSearchParams`, `usePathname`, route params) sit inside
  `<Suspense>`, as Next 16 requires.
- **SSE over POST.** `EventSource` only supports GET, so the analyze stream is read with
  `fetch` and a small SSE parser in `src/lib/api.ts`.
- **API URL.** `next.config.ts` reads *only* `NEXT_PUBLIC_API_URL` from the root `.env`. It
  never loads the whole file, which also holds server secrets.
- **Theme.** A small custom provider plus an inline `<head>` script, following the Next 16
  "preventing flash" guide. This replaces `next-themes`, which renders a `<script>` from a
  client component. One accent colour (indigo); green, amber and red are reserved for
  approve, escalate and decline.
- **Queue.** Loads all requests once and filters in the browser: 40 rows, instant counts.
  Filters live in the URL, so going back from a review restores them. The default view is
  "Needs review" (pending plus analyzed).
- **Citations** open in a side sheet with the cited sentence highlighted, plus a link to the
  full policy viewer (`/policies/{client}?section=…&q=…`). The policy viewer was built in
  M4 because citation links depend on it.
- **Overrides.** Choosing the AI's recommendation records the decision immediately. Any
  other choice opens a dialog that requires a reason (at least 5 characters). After a
  decision, a "Next request" button moves to the next open item.

## Insights, packaging and deployment (M5)
- **Charts are plain HTML and CSS, with no chart library.** The forms were picked by the
  job each one does: stat tiles for headline numbers, meter bars for ratios against a
  target, segmented bars for the AI vs human decision mix, a histogram for latency, and a
  heat table for the confusion matrix. Every chart has hover/focus tooltips and either a
  table view or visible figures.
- **Chart fills use their own colour tokens** (`--chart-approve`, `--chart-escalate`,
  `--chart-decline`), checked with the dataviz palette validator for colour-blind
  separation in both themes. The UI's green, amber and red text colours failed that check
  in chart form (escalate and decline were too close), so they stay for badges, which
  always pair colour with an icon and a label.
- **The "New request" form and the "Reset demo" button** live on the queue page for live
  demos. Reset clears requests, analyses and decisions but keeps the daily spend record.
- **Docker.** The backend image builds from the repo root because it needs `data/` and
  `evals/`. Writable state (SQLite and Chroma) lives in `/app/state` on a volume, and the
  container runs as a non-root user. The frontend uses Next's standalone output.
  `NEXT_PUBLIC_API_URL` is baked into the bundle at build time, so the compose file passes
  it as a build arg.
- **Render's persistent disk.** If the mounted disk isn't writable by the image's non-root
  user (uid 10001), either change the disk's ownership or drop the `USER app` line for that
  deployment.
- **Docker images couldn't be built here** because the Docker daemon wasn't running. The
  compose file was validated (`docker compose config`), the Next standalone server was
  built and smoke-tested locally, and CI builds both images.

## Client onboarding
- **The AI drafts, code checks, a person saves.** `POST /onboarding/draft` asks the model
  for the settings as strict structured output, with a section ID for each setting and
  notes for anything ambiguous. Nothing is stored at that point. `POST /onboarding/check`
  re-runs the deterministic checks while the reviewer edits, and `POST /clients` runs them
  again and refuses to save if any error remains.
- **Numbers are checked against the cited text.** If a limit, rate, mileage or percentage
  doesn't appear in the section it is mapped to, the field gets a warning (not an error),
  because a policy can state a value in words. Missing required sections, unknown shops,
  and contradictions such as a quote limit below the quote threshold are errors.
- **Policies must use numbered section headings** (`### AB-2.1 Title`), the same format as
  the built-in policies. The two-letter prefix becomes the client ID. This keeps citations
  stable and verifiable. Parsing free-form PDFs was left out as a bigger, separate problem.
- **Vehicles are pasted as CSV.** When the CSV has no warranty columns, typical terms are
  used: 36 months / 36k miles basic, plus 60 months / 100k miles powertrain for combustion
  vehicles or 96 months / 100k miles battery for EVs. Without vehicles a client can't
  receive requests, so at least one is required.
- **If the model leaves out "requests above the limit"**, it defaults to the approval-limit
  section, with a note for the reviewer. Live runs showed the model often skips that key
  because one section usually covers both.
- **Storage.** Onboarded clients live in a SQLite table and are loaded into an in-process
  registry at startup, so the rule engine, agent and API treat them like built-in clients.
  Their sections are added to the live search index without a restart. Reset demo removes
  them along with their requests.
- **Without an API key**, drafting returns a 503 and the reviewer can fill in the form by
  hand (`POST /onboarding/parse` reads the sections without the AI). Drafting counts
  towards the rate limit and the daily spend cap (about $0.002 per draft with gpt-4.1-mini).

## What would change the decision
- **Plain code, not the model.** For each finding that stops an approval, the request is
  changed just enough to clear it (lower the total to the limit, switch to an approved
  shop, add the required quotes, cap the labour rate, wait for the service interval,
  remove an excluded line), and the rule engine is re-run. The UI shows the resulting
  rule outcome for each change on its own and, when there are several, for all of them
  together. The AI's judgement isn't re-run, and the panel says so.
- **Some findings can't be changed away.** Pre-approval and specialist-review rules are
  shown as "no change to the request avoids this". Removing the only line on a request
  (excluded work, or work covered by warranty) says that nothing would be left to bill,
  rather than claiming an Approve.
- **Computed when the request is opened** (`what_if` in `GET /requests/{id}`), not stored
  with the analysis. It's cheap and deterministic, and it works for analyses saved earlier.
- **Totals are scaled down evenly and rounded down**, so the changed total never ends up a
  cent over the limit.
