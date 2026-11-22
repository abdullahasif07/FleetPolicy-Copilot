import { Suspense } from "react";
import { QueueSkeleton, QueueView } from "@/features/queue/queue-view";

export default function QueuePage() {
  return (
    <Suspense fallback={<QueueSkeleton />}>
      <QueueView />
    </Suspense>
  );
}
