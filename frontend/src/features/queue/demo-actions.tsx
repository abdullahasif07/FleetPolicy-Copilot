"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createRequest, resetDemo } from "@/lib/api";
import { categoryLabel, money } from "@/lib/format";
import type { ClientInfo, Shop, Vehicle } from "@/lib/types";

const CATEGORIES = [
  "brakes", "tires", "steering", "suspension", "engine", "transmission", "electrical", "hvac",
  "battery_12v", "battery_hv", "electric_drive", "preventive_maintenance", "body", "glass",
  "reefer", "aerial_hydraulics", "accessories", "cosmetic", "diagnostic", "other",
];

interface ItemDraft {
  description: string;
  category: string;
  part_cost: string;
  labor_hours: string;
  labor_rate: string;
}

const emptyItem = (): ItemDraft => ({
  description: "",
  category: "brakes",
  part_cost: "",
  labor_hours: "",
  labor_rate: "",
});

const num = (s: string) => (s.trim() === "" ? null : Number(s));

export function NewRequestDialog() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [shopId, setShopId] = useState("");
  const [odometer, setOdometer] = useState("");
  const [quotes, setQuotes] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clients = useSWR<ClientInfo[]>(open ? "/clients" : null);
  const vehicles = useSWR<Vehicle[]>(open && clientId ? `/vehicles?client_id=${clientId}` : null);
  const shops = useSWR<Shop[]>(open ? "/shops" : null);
  const client = clients.data?.find((c) => c.client_id === clientId);
  const approved = new Set(client?.approved_vendors.map((v) => v.shop_id));

  const total = items.reduce((s, i) => {
    const p = num(i.part_cost) ?? 0;
    const h = num(i.labor_hours) ?? 0;
    const r = num(i.labor_rate) ?? 0;
    return s + p + h * r;
  }, 0);

  const valid =
    clientId &&
    vehicleId &&
    shopId &&
    items.every((i) => i.description.trim() && i.part_cost !== "" && i.labor_hours !== "" && i.labor_rate !== "");

  function reset() {
    setClientId("");
    setVehicleId("");
    setShopId("");
    setOdometer("");
    setQuotes("");
    setNotes("");
    setItems([emptyItem()]);
    setError(null);
  }

  function updateItem(i: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createRequest({
        client_id: clientId,
        vehicle_id: vehicleId,
        shop_id: shopId,
        odometer: num(odometer),
        quotes_count: num(quotes),
        shop_notes: notes,
        line_items: items.map((i) => ({
          description: i.description.trim(),
          category: i.category,
          part_code: null,
          quantity: 1,
          part_cost: num(i.part_cost),
          labor_hours: num(i.labor_hours),
          labor_rate: num(i.labor_rate),
        })),
      });
      await mutate("/requests");
      toast.success(`Created ${created.request_id}`, { description: "Opening the review workspace." });
      setOpen(false);
      reset();
      router.push(`/requests/${created.request_id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> New request
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New repair request</DialogTitle>
            <DialogDescription>
              Submit a custom request for a live demo. Try an over-limit job, a non-approved shop, or
              an instruction hidden in the shop notes.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="nr-client">Client</Label>
              <Select
                value={clientId}
                onValueChange={(v) => {
                  setClientId(v);
                  setVehicleId("");
                  setOdometer("");
                }}
              >
                <SelectTrigger id="nr-client" className="w-full">
                  <SelectValue placeholder="Choose client" />
                </SelectTrigger>
                <SelectContent>
                  {clients.data?.map((c) => (
                    <SelectItem key={c.client_id} value={c.client_id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nr-vehicle">Vehicle</Label>
              <Select
                value={vehicleId}
                disabled={!clientId}
                onValueChange={(v) => {
                  setVehicleId(v);
                  const veh = vehicles.data?.find((x) => x.vehicle_id === v);
                  if (veh) setOdometer(String(veh.mileage));
                }}
              >
                <SelectTrigger id="nr-vehicle" className="w-full">
                  <SelectValue placeholder={clientId ? "Choose vehicle" : "Choose client first"} />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.data?.map((v) => (
                    <SelectItem key={v.vehicle_id} value={v.vehicle_id}>
                      {v.unit_number} · {v.year} {v.make} {v.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nr-shop">Shop</Label>
              <Select value={shopId} onValueChange={setShopId}>
                <SelectTrigger id="nr-shop" className="w-full">
                  <SelectValue placeholder="Choose shop" />
                </SelectTrigger>
                <SelectContent>
                  {shops.data?.map((s) => (
                    <SelectItem key={s.shop_id} value={s.shop_id}>
                      {s.name}
                      {clientId && !approved.has(s.shop_id) && " (not approved)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nr-odo">Odometer (mi)</Label>
              <Input id="nr-odo" inputMode="numeric" type="number" min={0} value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder="Leave blank to test missing info" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nr-quotes">Written quotes</Label>
              <Input id="nr-quotes" inputMode="numeric" type="number" min={0} max={20} value={quotes} onChange={(e) => setQuotes(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Line items</legend>
            {items.map((it, i) => (
              <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_repeat(3,minmax(0,0.8fr))_auto]">
                <Input aria-label={`Line ${i + 1} description`} placeholder="Description" value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })} maxLength={500} />
                <Select value={it.category} onValueChange={(v) => updateItem(i, { category: v })}>
                  <SelectTrigger aria-label={`Line ${i + 1} category`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {categoryLabel(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input aria-label={`Line ${i + 1} parts cost`} placeholder="Parts $" type="number" min={0} step="0.01" value={it.part_cost} onChange={(e) => updateItem(i, { part_cost: e.target.value })} />
                <Input aria-label={`Line ${i + 1} labour hours`} placeholder="Hours" type="number" min={0} step="0.1" value={it.labor_hours} onChange={(e) => updateItem(i, { labor_hours: e.target.value })} />
                <Input aria-label={`Line ${i + 1} labour rate`} placeholder="Rate $/h" type="number" min={0} step="1" value={it.labor_rate} onChange={(e) => updateItem(i, { labor_rate: e.target.value })} />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} disabled={items.length === 1} onClick={() => setItems((p) => p.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button type="button" variant="outline" size="sm" onClick={() => setItems((p) => [...p, emptyItem()])} disabled={items.length >= 20}>
                <Plus className="size-3.5" /> Add line
              </Button>
              <p className="text-sm">
                Total <span className="font-semibold tabular-nums">{money(total)}</span>
              </p>
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="nr-notes">Shop notes (untrusted)</Label>
            <Textarea id="nr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder="e.g. Pads worn to 2 mm." />
          </div>

          {error && (
            <p role="alert" className="text-sm text-decline">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />} Create request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ResetDemoButton() {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await resetDemo();
      await mutate(() => true); // revalidate every cached query
      toast.success("Demo reset", { description: "All analyses, decisions and custom requests were cleared." });
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <RotateCcw className="size-3.5" /> Reset demo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset the demo?</DialogTitle>
          <DialogDescription>
            This clears every analysis, decision and custom request, and restores the 40 sample
            requests. The daily AI budget is not reset.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />} Reset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
