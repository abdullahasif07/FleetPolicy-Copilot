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
