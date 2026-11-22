"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ErrorState } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";
import type { ClientInfo, PolicyDoc } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PolicyDocument } from "./policy-document";

export function PolicyViewer({ clientId }: { clientId: string }) {
  const params = useSearchParams();
  const section = params.get("section");
  const quote = params.get("q");
  const clients = useSWR<ClientInfo[]>("/clients");
  const doc = useSWR<PolicyDoc>(`/policies/${clientId}`);

  return (
    <div className="mx-auto grid max-w-[1440px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Clients</p>
        <nav aria-label="Client policies" className="mt-2 flex gap-1 overflow-x-auto lg:flex-col">
          {clients.data?.map((c) => (
            <Link
              key={c.client_id}
              href={`/policies/${c.client_id}`}
              aria-current={c.client_id === clientId ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap",
                c.client_id === clientId
                  ? "bg-muted font-medium"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {c.name}
            </Link>
          )) ??
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </nav>
        {doc.data && (
          <>
            <p className="mt-6 hidden text-xs font-semibold tracking-wide text-muted-foreground uppercase lg:block">
              Sections
            </p>
            <ol className="mt-2 hidden space-y-0.5 lg:block">
              {doc.data.sections.map((s) => (
                <li key={s.section_id}>
                  <Link
                    href={`/policies/${clientId}?section=${s.section_id}`}
                    scroll={false}
                    className={cn(
                      "flex gap-2 rounded px-2 py-1 text-xs",
                      s.section_id === section
                        ? "bg-escalate-soft font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="w-12 shrink-0 font-mono">{s.section_id}</span>
                    <span className="truncate">{s.heading}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </>
        )}
      </aside>

      <article className="min-w-0">
        {doc.error ? (
          <ErrorState message={doc.error.message} onRetry={() => doc.mutate()} />
        ) : !doc.data ? (
          <div className="space-y-3">
            <Skeleton className="h-7 w-80" />
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : (
          <>
            <header className="mb-6 px-4">
              <p className="text-xs text-muted-foreground">Fleet maintenance policy · fictional</p>
              <h1 className="text-xl font-semibold tracking-tight">{doc.data.name}</h1>
              {clients.data && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {clients.data.find((c) => c.client_id === clientId)?.summary}
                </p>
              )}
            </header>
            <PolicyDocument sections={doc.data.sections} activeSection={section} quote={quote} />
          </>
        )}
      </article>
    </div>
  );
}
