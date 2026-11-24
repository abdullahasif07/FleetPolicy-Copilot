import type { Decision } from "./types";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-US");

export const money = (n: number | null | undefined) => (n == null ? "—" : usd.format(n));
export const moneyWhole = (n: number | null | undefined) =>
  n == null ? "—" : usdWhole.format(n);
export const miles = (n: number | null | undefined) => (n == null ? "—" : `${num.format(n)} mi`);
export const number = (n: number) => num.format(n);

export function age(iso: string, now: number = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const DECISION_LABEL: Record<Decision, string> = {
  APPROVE: "Approve",
  ESCALATE: "Escalate",
  DECLINE: "Decline",
};

export const DECISION_PAST: Record<Decision, string> = {
  APPROVE: "Approved",
  ESCALATE: "Escalated",
  DECLINE: "Declined",
};

export function categoryLabel(c: string | null | undefined): string {
  if (!c) return "Uncategorized";
  const special: Record<string, string> = {
    hvac: "HVAC",
    battery_hv: "HV battery",
    battery_12v: "12V battery",
    preventive_maintenance: "Preventive maintenance",
    aerial_hydraulics: "Aerial hydraulics",
    electric_drive: "Electric drive",
  };
  return special[c] ?? c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, " ");
}

/** Collapse whitespace and smart quotes so quotes match the policy text. */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export const CATEGORIES = [
  "brakes", "tires", "steering", "suspension", "engine", "transmission", "electrical", "hvac",
  "battery_12v", "battery_hv", "electric_drive", "preventive_maintenance", "body", "glass",
  "reefer", "aerial_hydraulics", "accessories", "cosmetic", "diagnostic", "other",
];
