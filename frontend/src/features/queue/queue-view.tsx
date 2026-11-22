"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Search, ShieldAlert, X } from "lucide-react";
import { DecisionBadge, StatusChip } from "@/components/decision";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { age, money } from "@/lib/format";
import type { RequestSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

type View = "open" | "decided" | "all";

const VIEWS: { value: View; label: string }[] = [
  { value: "open", label: "Needs review" },
  { value: "decided", label: "Decided" },
  { value: "all", label: "All" },
];

function matchesView(r: RequestSummary, view: View) {
  if (view === "open") return r.status !== "decided";
  if (view === "decided") return r.status === "decided";
  return true;
}

export function QueueView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = (params.get("view") as View | null) ?? "open";
  const client = params.get("client") ?? "all";
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [selected, setSelected] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  const { data, error, isLoading, mutate } = useSWR<RequestSummary[]>("/requests");

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Debounce the search box into the URL so back-navigation restores it.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== query) setParam("q", query || null);
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const clients = useMemo(() => {
    const m = new Map<string, string>();
    data?.forEach((r) => m.set(r.client_id, r.client_name));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const counts = useMemo(() => {
    const base = (data ?? []).filter((r) => client === "all" || r.client_id === client);
    return {
      open: base.filter((r) => matchesView(r, "open")).length,
      decided: base.filter((r) => matchesView(r, "decided")).length,
      all: base.length,
    };
  }, [data, client]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data ?? []).filter(
      (r) =>
        matchesView(r, view) &&
        (client === "all" || r.client_id === client) &&
        (!needle ||
          [r.request_id, r.client_name, r.shop_name, r.vehicle_label, r.unit_number ?? "", r.headline]
            .join(" ")
            .toLowerCase()
            .includes(needle)),
    );
  }, [data, view, client, query]);

  const current = Math.min(selected, Math.max(rows.length - 1, 0));

  useEffect(() => {
    rowRefs.current[current]?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const open = (r: RequestSummary | undefined) => r && router.push(`/requests/${r.request_id}`);

  useHotkeys({
    j: () => setSelected(Math.min(current + 1, rows.length - 1)),
    ArrowDown: () => setSelected(Math.min(current + 1, rows.length - 1)),
    k: () => setSelected(Math.max(current - 1, 0)),
    ArrowUp: () => setSelected(Math.max(current - 1, 0)),
    Enter: () => open(rows[current]),
    o: () => open(rows[current]),
    "/": () => searchRef.current?.focus(),
  });

  const filtered = query !== "" || client !== "all";

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Repair request queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review each request against the client&apos;s fleet policy. The AI recommends; you decide.
          </p>
        </div>
        <p className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd> move · <Kbd>Enter</Kbd> open · <Kbd>/</Kbd> search
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Queue view" className="inline-flex rounded-lg border bg-muted/40 p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              role="tab"
              aria-selected={view === v.value}
              onClick={() => {
                setSelected(0);
                setParam("view", v.value === "open" ? null : v.value);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                view === v.value
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label}
              <span className="text-xs tabular-nums text-muted-foreground">
                {data ? counts[v.value] : "–"}
              </span>
            </button>
          ))}
        </div>

        <div className="relative w-full sm:ml-auto sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setSelected(0);
              setQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") (e.target as HTMLInputElement).blur();
              if (e.key === "Enter") open(rows[0]);
            }}
            placeholder="Search ID, shop, vehicle, work…"
            aria-label="Search requests"
            className="pl-8"
          />
        </div>

        <Select
          value={client}
          onValueChange={(v) => {
            setSelected(0);
            setParam("client", v === "all" ? null : v);
          }}
        >
          <SelectTrigger className="w-full sm:w-56" aria-label="Filter by client">
            <SelectValue placeholder="All clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4">
        {error ? (
          <ErrorState
            title="Couldn't load the queue"
            message={error.message}
            onRetry={() => mutate()}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[960px] text-sm" aria-label="Repair requests">
              <thead className="bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Request</th>
                  <th className="px-3 py-2.5 font-medium">Client</th>
                  <th className="px-3 py-2.5 font-medium">Vehicle</th>
                  <th className="px-3 py-2.5 font-medium">Shop</th>
                  <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-3 py-2.5 text-right font-medium">Age</th>
                  <th className="px-3 py-2.5 font-medium">AI recommendation</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading &&
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-t">
                      {Array.from({ length: 8 }).map((__, j) => (
                        <td key={j} className="px-3 py-3">
                          <Skeleton className={cn("h-4", j === 0 ? "w-48" : "w-20")} />
                        </td>
                      ))}
                    </tr>
                  ))}
                {rows.map((r, i) => (
                  <tr
                    key={r.request_id}
                    ref={(el) => {
                      rowRefs.current[i] = el;
                    }}
                    aria-selected={i === current}
                    onClick={() => open(r)}
                    onMouseEnter={() => setSelected(i)}
                    className={cn(
                      "cursor-pointer border-t transition-colors",
                      i === current ? "bg-primary/[0.06] dark:bg-primary/10" : "hover:bg-muted/40",
                    )}
                  >
                    <td className="relative max-w-[320px] px-3 py-2.5">
                      {i === current && (
                        <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden />
                      )}
                      <Link
                        href={`/requests/${r.request_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-mono text-xs text-muted-foreground hover:text-foreground focus-visible:underline focus-visible:outline-none"
                      >
                        {r.request_id}
                      </Link>
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{r.headline}</span>
                        {r.injection_flag && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <ShieldAlert
                                className="size-3.5 shrink-0 text-decline"
                                aria-label="Possible prompt injection in shop notes"
                              />
                            </TooltipTrigger>
                            <TooltipContent>Shop notes contain a possible prompt-injection attempt</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{r.client_name}</td>
                    <td className="px-3 py-2.5">
                      <div className="whitespace-nowrap">{r.vehicle_label}</div>
                      <div className="text-xs text-muted-foreground">{r.unit_number}</div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{r.shop_name}</td>
                    <td className="px-3 py-2.5 text-right font-medium whitespace-nowrap tabular-nums">
                      {money(r.total)}
                    </td>
                    <td
                      className="px-3 py-2.5 text-right whitespace-nowrap text-muted-foreground tabular-nums"
                      title={new Date(r.submitted_at).toLocaleString()}
                    >
                      {age(r.submitted_at)}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.ai_decision ? (
                        <DecisionBadge decision={r.ai_decision} />
                      ) : (
                        <span className="text-xs text-muted-foreground">Not analyzed</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusChip status={r.status} human={r.human_action} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!isLoading && rows.length === 0 && (
              <EmptyState
                className="m-4"
                title={filtered ? "No requests match your filters" : view === "open" ? "Queue is clear" : "Nothing here yet"}
                message={
                  filtered
                    ? "Try a different search or client."
                    : view === "open"
                      ? "Every request has a recorded decision."
                      : undefined
                }
                action={
                  filtered ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setQuery("");
                        router.replace(view === "open" ? pathname : `${pathname}?view=${view}`);
                      }}
                    >
                      <X className="size-3.5" /> Clear filters
                    </Button>
                  ) : undefined
                }
              />
            )}
          </div>
        )}
      </div>
      {data && (
        <p className="mt-3 text-xs text-muted-foreground">
          Showing {rows.length} of {data.length} requests
        </p>
      )}
    </div>
  );
}

export function QueueSkeleton() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
      <Skeleton className="h-6 w-56" />
      <Skeleton className="mt-2 h-4 w-96" />
      <Skeleton className="mt-6 h-9 w-full" />
      <Skeleton className="mt-4 h-[480px] w-full" />
    </div>
  );
}
