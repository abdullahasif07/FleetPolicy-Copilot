"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { DECISION_STYLES, DecisionBadge } from "@/components/decision";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DECISION_LABEL, dateTime } from "@/lib/format";
import type { Decision, DecisionOut } from "@/lib/types";
import { cn } from "@/lib/utils";

const ACTIONS: { action: Decision; key: string }[] = [
  { action: "APPROVE", key: "A" },
  { action: "ESCALATE", key: "E" },
  { action: "DECLINE", key: "D" },
];

export function ActionBar({
  aiDecision,
  disabled,
  submitting,
  onChoose,
  onShowShortcuts,
}: {
  aiDecision: Decision | null;
  disabled: boolean;
  submitting: Decision | null;
  onChoose: (d: Decision) => void;
  onShowShortcuts: () => void;
}) {
  return (
    <div className="border-t bg-background/95 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <p className="mr-auto hidden text-xs text-muted-foreground xl:block">
          {disabled ? "Run the analysis to decide" : "Your decision"}
        </p>
        {ACTIONS.map(({ action, key }) => {
          const s = DECISION_STYLES[action];
          const Icon = s.icon;
          const recommended = aiDecision === action;
          const button = (
            <Button
              key={action}
              variant="outline"
              disabled={disabled || submitting !== null}
              onClick={() => onChoose(action)}
              className={cn(
                "flex-1 justify-center gap-2 xl:flex-none",
                recommended && cn(s.soft, s.border, "ring-1 ring-current/20", s.text),
              )}
              aria-keyshortcuts={key}
            >
              {submitting === action ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Icon className={cn("size-4", s.text)} />
              )}
              {DECISION_LABEL[action]}
              <Kbd className="ml-1 hidden sm:inline-flex">{key}</Kbd>
            </Button>
          );
          return recommended ? (
            <Tooltip key={action}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent>Matches the AI recommendation</TooltipContent>
            </Tooltip>
          ) : (
            button
          );
        })}
        <Button variant="ghost" size="icon" onClick={onShowShortcuts} aria-label="Keyboard shortcuts">
          <Kbd>?</Kbd>
        </Button>
      </div>
    </div>
  );
}

export function DecidedBanner({ decision, nextId }: { decision: DecisionOut; nextId: string | null }) {
  return (
    <div className="border-t bg-muted/40 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <DecisionBadge decision={decision.human_action} past />
        <span className="text-muted-foreground">
          by you · {dateTime(decision.decided_at)}
          {decision.is_override && (
            <> · overrode AI ({DECISION_LABEL[decision.ai_decision]})</>
          )}
        </span>
        {nextId && (
          <Button asChild size="sm" className="ml-auto">
            <Link href={`/requests/${nextId}`}>
              Next request <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        )}
      </div>
      {decision.override_reason && (
        <p className="mt-1.5 text-xs text-muted-foreground">Reason: {decision.override_reason}</p>
      )}
    </div>
  );
}

export function OverrideDialog({
  action,
  aiDecision,
  onCancel,
  onConfirm,
  submitting,
}: {
  action: Decision | null;
  aiDecision: Decision | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  submitting: boolean;
}) {
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= 5;
  return (
    <Dialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open) {
          setReason("");
          onCancel();
        }
      }}
    >
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onConfirm(reason.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>
              Override AI recommendation: {action && DECISION_LABEL[action]}
            </DialogTitle>
            <DialogDescription>
              The AI recommended {aiDecision ? DECISION_LABEL[aiDecision] : "a different action"}.
              Add a short reason. It is saved to the audit log and used to improve the policy rules.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-2">
            <Label htmlFor="override-reason">Reason for override</Label>
            <Textarea
              id="override-reason"
              autoFocus
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && valid) onConfirm(reason.trim());
              }}
              placeholder="e.g. Fleet manager pre-approved this by phone (ticket #4821)"
              aria-invalid={reason.length > 0 && !valid}
              aria-describedby="override-hint"
            />
            <p id="override-hint" className="text-xs text-muted-foreground">
              At least 5 characters · <Kbd>⌘</Kbd>
              <Kbd>Enter</Kbd> to confirm
            </p>
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              Confirm {action && DECISION_LABEL[action].toLowerCase()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const SHORTCUTS: [string[], string][] = [
  [["A"], "Approve"],
  [["E"], "Escalate"],
  [["D"], "Decline"],
  [["?"], "Show this help"],
  [["Esc"], "Close dialogs and panels"],
  [["J", "K"], "Move through the queue"],
  [["Enter"], "Open the selected request"],
  [["/"], "Search the queue"],
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Work through the queue without a mouse.</DialogDescription>
        </DialogHeader>
        <ul className="mt-2 divide-y text-sm">
          {SHORTCUTS.map(([keys, label]) => (
            <li key={label} className="flex items-center justify-between py-2">
              <span>{label}</span>
              <span className="flex gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
