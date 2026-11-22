import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { PolicyViewer } from "@/features/policy/policy-viewer";

export const metadata: Metadata = { title: "Policies" };

export function generateStaticParams() {
  return ["NW", "CV", "HF", "SH"].map((clientId) => ({ clientId }));
}

export default function PolicyPage({ params }: PageProps<"/policies/[clientId]">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-[600px]" />}>
      {params.then(({ clientId }) => (
        <PolicyViewer clientId={clientId} />
      ))}
    </Suspense>
  );
}
