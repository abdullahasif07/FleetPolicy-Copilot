"use client";

import { useEffect, useMemo, useRef } from "react";
import { normalizeForMatch } from "@/lib/format";
import type { PolicyChunk } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Split text around the first case-insensitive occurrence of the quote. */
export function splitOnQuote(text: string, quote: string | null | undefined) {
  if (!quote) return null;
  const q = normalizeForMatch(quote).replace(/[.\s]+$/, "");
  if (q.length < 8) return null;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return null;
  let end = idx + q.length;
  if (text[end] === ".") end += 1;
  return { before: text.slice(0, idx), match: text.slice(idx, end), after: text.slice(end) };
}

export function PolicySection({
  section,
  highlighted,
  quote,
}: {
  section: PolicyChunk;
  highlighted: boolean;
  quote?: string | null;
}) {
  const parts = highlighted ? splitOnQuote(section.text, quote) : null;
  return (
    <section
      id={section.section_id}
      data-section={section.section_id}
      aria-current={highlighted ? "true" : undefined}
      className={cn(
        "scroll-mt-24 rounded-lg border border-transparent px-4 py-3 transition-colors",
        highlighted && "border-escalate/40 bg-escalate-soft/50",
      )}
    >
      <h3 className="flex items-baseline gap-2 text-sm font-semibold">
        <span className="font-mono text-xs font-medium text-muted-foreground">
          {section.section_id}
        </span>
        {section.heading}
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">
        {parts ? (
          <>
            {parts.before}
            <mark className="citation">{parts.match}</mark>
            {parts.after}
          </>
        ) : (
          section.text
        )}
      </p>
    </section>
  );
}

export function PolicyDocument({
  sections,
  activeSection,
  quote,
  scrollContainer,
}: {
  sections: PolicyChunk[];
  activeSection?: string | null;
  quote?: string | null;
  /** Element whose scroll position should move; defaults to the window. */
  scrollContainer?: React.RefObject<HTMLElement | null>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const grouped = useMemo(() => {
    const out: { part: string; items: PolicyChunk[] }[] = [];
    for (const s of sections) {
      const last = out.at(-1);
      if (last && last.part === s.part) last.items.push(s);
      else out.push({ part: s.part, items: [s] });
    }
    return out;
  }, [sections]);

  useEffect(() => {
    if (!activeSection) return;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-section="${activeSection}"]`);
    if (!el) return;
    const container = scrollContainer?.current;
    if (container) {
      const top = el.offsetTop - container.offsetTop - 80;
      container.scrollTo({ top, behavior: "smooth" });
    } else {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeSection, quote, sections, scrollContainer]);

  return (
    <div ref={rootRef} className="space-y-6">
      {grouped.map((g) => (
        <div key={g.part}>
          <h2 className="px-4 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {g.part}
          </h2>
          <div className="mt-1 space-y-0.5">
            {g.items.map((s) => (
              <PolicySection
                key={s.section_id}
                section={s}
                highlighted={s.section_id === activeSection}
                quote={s.section_id === activeSection ? quote : null}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
