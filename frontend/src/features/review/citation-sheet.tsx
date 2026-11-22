"use client";

import Link from "next/link";
import { useRef } from "react";
import useSWR from "swr";
import { ExternalLink } from "lucide-react";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { PolicyDocument } from "@/features/policy/policy-document";
import type { PolicyDoc } from "@/lib/types";

export interface CitationTarget {
  sectionId: string;
  quote?: string | null;
}

export function CitationSheet({
  clientId,
  target,
  onClose,
}: {
  clientId: string;
  target: CitationTarget | null;
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { data, error, mutate } = useSWR<PolicyDoc>(target ? `/policies/${clientId}` : null);
  const section = data?.sections.find((s) => s.section_id === target?.sectionId);
  const href = target
    ? `/policies/${clientId}?section=${target.sectionId}${target.quote ? `&q=${encodeURIComponent(target.quote)}` : ""}`
    : "#";

  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>
            {target?.sectionId} {section ? `· ${section.heading}` : ""}
          </SheetTitle>
          <SheetDescription>{data?.name ?? "Policy"}: cited clause highlighted</SheetDescription>
        </SheetHeader>
        <div ref={scrollRef} className="relative flex-1 overflow-y-auto py-4">
          {error ? (
            <ErrorState className="m-4" message={error.message} onRetry={() => mutate()} />
          ) : !data ? (
            <div className="space-y-3 px-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : (
            <PolicyDocument
              sections={data.sections}
              activeSection={target?.sectionId}
              quote={target?.quote}
              scrollContainer={scrollRef}
            />
          )}
        </div>
        <SheetFooter className="border-t px-5 py-3">
          <Button variant="outline" size="sm" asChild>
            <Link href={href}>
              <ExternalLink className="size-3.5" /> Open in policy viewer
            </Link>
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
