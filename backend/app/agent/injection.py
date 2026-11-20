"""Heuristic prompt-injection detector for untrusted shop notes.

Detection is for *flagging* only. Safety does not depend on it: shop notes are delimited
as untrusted data, the rules ignore them, and the validator overrides the LLM.
"""

from __future__ import annotations

import re

_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("ignore instructions", re.compile(
        r"\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(rules?|instructions?|polic(y|ies)|"
        r"limits?|guidelines?)\b", re.I)),
    ("system override", re.compile(r"\bsystem\s*(override|prompt|message)\b", re.I)),
    ("addresses the AI", re.compile(
        r"\b(as (the|an) ai|ai (assistant|reviewer|model)|language model|note to (the )?ai)\b",
        re.I)),
    ("claims authorization", re.compile(
        r"\b(you are (now )?authori[sz]ed|pre-?authori[sz]ed|bypass|waived?)\b", re.I)),
    ("demands a decision", re.compile(
        r"\b(approve (this|now|immediately|it)|output (decision|approve)|must approve|"
        r"decision\s*[:=]?\s*approve|confidence\s*[:=]?\s*1(\.0)?)\b", re.I)),
    ("new instructions", re.compile(r"\bnew instructions?\b", re.I)),
    ("concealment", re.compile(r"\bdo not (mention|reveal|tell)\b", re.I)),
    ("markup / tag spoofing", re.compile(r"</?\s*[a-z_]{3,}\s*>", re.I)),
]


def detect_injection(text: str) -> list[str]:
    """Return the names of the injection signals found in ``text``."""
    return [name for name, pattern in _PATTERNS if pattern.search(text or "")]


def neutralize(text: str) -> str:
    """Make untrusted text unable to close or spoof our prompt delimiters."""
    return (text or "").replace("<", "‹").replace(">", "›")
