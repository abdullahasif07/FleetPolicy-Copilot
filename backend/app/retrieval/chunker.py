"""Split policy markdown into one chunk per numbered section (### XX-n.n Heading)."""

from __future__ import annotations

import re

from pydantic import BaseModel

_PART_RE = re.compile(r"^## (.+)$")
_SECTION_RE = re.compile(r"^### ([A-Z]{2}-\d+\.\d+) (.+)$")


class PolicyChunk(BaseModel):
    chunk_id: str
    client_id: str
    section_id: str
    heading: str
    part: str
    text: str

    @property
    def embed_text(self) -> str:
        return f"{self.part} > {self.heading}\n{self.text}"


def chunk_policy(client_id: str, markdown: str) -> list[PolicyChunk]:
    chunks: list[PolicyChunk] = []
    part = ""
    current: tuple[str, str] | None = None
    body: list[str] = []

    def flush() -> None:
        if current is None:
            return
        text = " ".join(line.strip() for line in body if line.strip())
        chunks.append(PolicyChunk(chunk_id=f"{client_id}:{current[0]}", client_id=client_id,
                                  section_id=current[0], heading=current[1], part=part,
                                  text=text))

    for line in markdown.splitlines():
        if m := _SECTION_RE.match(line):
            flush()
            current, body = (m.group(1), m.group(2).strip()), []
        elif m := _PART_RE.match(line):
            flush()
            current, body = None, []
            part = m.group(1).strip()
        elif current is not None:
            body.append(line)
    flush()
    return chunks


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.;:])\s+(?=[A-Z$])", text) if s.strip()]
