"""Deterministic checks on a client's structured settings before they go live.

The AI drafts the settings; these checks decide whether they can be saved (errors) and
point the reviewer at values worth a second look (warnings).
"""

from __future__ import annotations

import re
from collections.abc import Callable, Collection, Mapping
from typing import Literal

from pydantic import BaseModel

from app.models.domain import ClientPolicy
from app.retrieval.chunker import PolicyChunk

# Every policy "slot" the rule engine can cite, with a human label for the review form.
SECTION_KEYS: dict[str, str] = {
    "auto_approve": "Standard approval limit",
    "over_limit": "Requests above the limit",
    "category_limit": "Higher limits for some categories",
    "quotes": "Competing quotes",
    "pre_approval": "Work needing pre-approval",
    "always_escalate": "Work that is always escalated",
    "warranty": "Warranty handling",
    "warranty_battery": "EV battery warranty",
    "vendor": "Non-approved vendors",
    "labor_cap": "Labour-rate cap",
    "parts_markup": "Parts price review",
    "pm_interval": "Service interval",
    "pm_early": "Early preventive maintenance",
    "exclusion": "Excluded work",
    "missing_info": "Missing information",
}
ALWAYS_REQUIRED = ("auto_approve", "over_limit", "warranty", "vendor", "labor_cap",
                   "pm_interval", "missing_info")


class Issue(BaseModel):
    field: str
    level: Literal["error", "warning"]
    message: str


def required_keys(p: ClientPolicy) -> list[str]:
    """Section keys the rule engine may cite for these settings."""
    keys = list(ALWAYS_REQUIRED)
    conditional: list[tuple[str, bool]] = [
        ("category_limit", bool(p.category_limits)),
        ("quotes", p.quote_threshold is not None),
        ("pre_approval", bool(p.pre_approval_categories)),
        ("always_escalate", bool(p.always_escalate_categories)),
        ("exclusion", bool(p.excluded_categories)),
        ("parts_markup", p.parts_markup_review_pct is not None),
        ("pm_early", p.pm_min_miles is not None),
    ]
    keys += [k for k, needed in conditional if needed]
    return keys


def _amount_patterns(v: float) -> list[str]:
    forms = {f"{v:,.2f}", f"{v:.2f}"}
    if v == int(v):
        forms |= {f"{int(v):,}", str(int(v))}
    return sorted(forms, key=len, reverse=True)


def mentions_number(text: str, v: float, percent: bool = False) -> bool:
    """True when ``v`` appears in ``text`` as a standalone number (e.g. $1,200.00, 6,000)."""
    for form in _amount_patterns(v):
        suffix = r"\s*(%|percent)" if percent else r"(?![\d,]|\.\d)"
        if re.search(rf"(?<![\d.,]){re.escape(form)}{suffix}", text, re.I):
            return True
    return False


def check_policy(
    p: ClientPolicy,
    chunks: list[PolicyChunk],
    shop_ids: Collection[str],
    existing_client_ids: Collection[str] = (),
) -> list[Issue]:
    issues: list[Issue] = []

    def err(field: str, msg: str) -> None:
        issues.append(Issue(field=field, level="error", message=msg))

    def warn(field: str, msg: str) -> None:
        issues.append(Issue(field=field, level="warning", message=msg))

    texts: Mapping[str, str] = {c.section_id: c.text for c in chunks}

    # Identity -----------------------------------------------------------------------
    if not re.fullmatch(r"[A-Z]{2}", p.client_id):
        err("client_id", "Client ID must be two capital letters, matching the section IDs.")
    elif p.client_id in existing_client_ids:
        err("client_id", f"A client with ID {p.client_id} already exists.")
    if not p.name.strip():
        err("name", "Client name is required.")
    if not p.summary.strip():
        err("summary", "Add a one-line summary for reviewers.")

    # Numbers --------------------------------------------------------------------------
    if p.auto_approve_limit <= 0:
        err("auto_approve_limit", "The approval limit must be above $0.")
    if p.labor_rate_cap <= 0:
        err("labor_rate_cap", "The labour-rate cap must be above $0.")
    for cat, limit in p.category_limits.items():
        if limit <= 0:
            err("category_limits", f"The {cat} limit must be above $0.")
    if p.quote_threshold is not None:
        if p.quotes_required < 1:
            err("quotes_required", "Set how many quotes are needed above the quote threshold.")
        if p.limit_with_quotes is not None and p.limit_with_quotes < p.quote_threshold:
            err("limit_with_quotes", "The limit with quotes can't be below the quote threshold.")
    elif p.limit_with_quotes is not None:
        err("limit_with_quotes", "A limit with quotes needs a quote threshold.")
    if p.pm_interval_miles is not None and p.pm_min_miles is not None \
            and p.pm_min_miles > p.pm_interval_miles:
        err("pm_min_miles", "The early-service minimum can't exceed the service interval.")

    # Vendors and categories -----------------------------------------------------------
    if not p.approved_vendors:
        err("approved_vendors", "Pick at least one approved vendor.")
    for shop in p.approved_vendors:
        if shop not in shop_ids:
            err("approved_vendors", f"Unknown shop {shop}.")
    overlap = set(p.excluded_categories) & (
        set(p.pre_approval_categories) | set(p.always_escalate_categories))
    if overlap:
        warn("excluded_categories", "Listed as both excluded and needing review: "
             + ", ".join(sorted(str(c) for c in overlap)) + ". Excluded wins (decline).")

    # Section mapping ------------------------------------------------------------------
    for key, section_id in p.sections.items():
        if key not in SECTION_KEYS:
            err(f"sections.{key}", f"Unknown section key {key!r}.")
        elif section_id not in texts:
            err(f"sections.{key}", f"{section_id} is not a section of this policy.")
    for key in required_keys(p):
        if key not in p.sections:
            err(f"sections.{key}",
                f"Pick the section that covers “{SECTION_KEYS[key]}”.")

    # Values the cited section should actually state -------------------------------------
    def stated(key: str, field: str, value: float | None, label: str,
               fmt: Callable[[float], str], percent: bool = False) -> None:
        if value is None or key not in p.sections or p.sections[key] not in texts:
            return
        if not mentions_number(texts[p.sections[key]], value, percent):
            warn(field, f"{label} {fmt(value)} isn't written in {p.sections[key]}. "
                 "Double-check it against the policy.")

    def money(v: float) -> str:
        return f"${v:,.2f}"

    def miles(v: float) -> str:
        return f"{v:,.0f} miles"

    stated("auto_approve", "auto_approve_limit", p.auto_approve_limit, "Approval limit", money)
    stated("labor_cap", "labor_rate_cap", p.labor_rate_cap, "Labour cap", money)
    stated("quotes", "quote_threshold", p.quote_threshold, "Quote threshold", money)
    if p.limit_with_quotes is not None:
        keys = [k for k in ("quotes", "over_limit") if k in p.sections]
        if keys and not any(p.sections[k] in texts and
                            mentions_number(texts[p.sections[k]], p.limit_with_quotes)
                            for k in keys):
            warn("limit_with_quotes", f"Limit with quotes {money(p.limit_with_quotes)} isn't "
                 "written in the cited sections. Double-check it against the policy.")
    for cat, limit in p.category_limits.items():
        stated("category_limit", "category_limits", limit, f"The {cat} limit", money)
    stated("pm_interval", "pm_interval_miles", p.pm_interval_miles, "Service interval", miles)
    stated("pm_early", "pm_min_miles", p.pm_min_miles, "Early-service minimum", miles)
    stated("parts_markup", "parts_markup_review_pct", p.parts_markup_review_pct,
           "Parts review threshold", lambda v: f"{v:g}%", percent=True)
    return issues


def has_errors(issues: list[Issue]) -> bool:
    return any(i.level == "error" for i in issues)
