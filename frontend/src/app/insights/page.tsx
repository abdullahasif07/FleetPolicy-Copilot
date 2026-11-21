import type { Metadata } from "next";
import { EmptyState } from "@/components/states";

export const metadata: Metadata = { title: "Insights" };

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <EmptyState title="Insights" message="This page is built in milestone 5." />
    </div>
  );
}
