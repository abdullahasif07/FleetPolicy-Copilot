import { CircleCheck, CircleDot, CircleX, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { DECISION_LABEL, DECISION_PAST } from "@/lib/format";
import type { Decision, RequestStatus } from "@/lib/types";

export const DECISION_STYLES: Record<
  Decision,
  { text: string; soft: string; border: string; bar: string; icon: typeof CircleCheck }
> = {
  APPROVE: {
    text: "text-approve",
    soft: "bg-approve-soft",
    border: "border-approve/30",
    bar: "bg-approve",
    icon: CircleCheck,
  },
  ESCALATE: {
    text: "text-escalate",
    soft: "bg-escalate-soft",
    border: "border-escalate/30",
    bar: "bg-escalate",
    icon: TriangleAlert,
  },
  DECLINE: {
    text: "text-decline",
    soft: "bg-decline-soft",
    border: "border-decline/30",
    bar: "bg-decline",
    icon: CircleX,
  },
};

export function DecisionBadge({
  decision,
  past = false,
  className,
}: {
  decision: Decision;
  past?: boolean;
  className?: string;
}) {
  const s = DECISION_STYLES[decision];
  const Icon = s.icon;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        s.text,
        s.soft,
        s.border,
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {past ? DECISION_PAST[decision] : DECISION_LABEL[decision]}
    </span>
  );
}

export function StatusChip({
  status,
  human,
}: {
  status: RequestStatus;
  human?: Decision | null;
}) {
  if (status === "decided" && human) return <DecisionBadge decision={human} past />;
  const label = status === "analyzed" ? "Ready for review" : "Pending";
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        status === "analyzed"
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      <CircleDot className="size-3" aria-hidden />
      {label}
    </span>
  );
}
