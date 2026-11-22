import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewSkeleton, ReviewWorkspace } from "@/features/review/review-workspace";

export const metadata: Metadata = { title: "Review request" };

export default function ReviewPage({ params }: PageProps<"/requests/[id]">) {
  return (
    <Suspense fallback={<ReviewSkeleton />}>
      {params.then(({ id }) => (
        <ReviewWorkspace key={id} id={id} />
      ))}
    </Suspense>
  );
}
