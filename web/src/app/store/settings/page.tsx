"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { api, formatMoney, type Store, type StoreEvent } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ---------------------------------------------------------------------------
// Form state types
// ---------------------------------------------------------------------------

const emptyProfile = {
  name: "",
  slug: "",
  store_type: "personal",
  description: "",
  return_policy: "",
  status: "active",
  phone: "",
  email: "",
  website: "",
  address_line1: "",
  address_line2: "",
  address_city: "",
  address_region: "",
  address_postal_code: "",
  address_country: "US",
  facebook_url: "",
  instagram_url: "",
  discord_url: "",
  twitter_url: "",
  youtube_url: "",
  ship_from_recipient: "",
  ship_from_line1: "",
  ship_from_line2: "",
  ship_from_city: "",
  ship_from_region: "",
  ship_from_postal_code: "",
  ship_from_country: "US",
};

const emptyEvent = {
  title: "",
  description: "",
  event_type: "other",
  starts_at: "",
  ends_at: "",
  entry_fee_dollars: "",
  max_players: "",
  is_recurring: false,
  recurrence: "weekly",
};

const RECURRENCE_LABELS: Record<string, string> = {
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
};

function formatRecurringSchedule(e: StoreEvent): string {
  const day = new Date(e.starts_at).toLocaleDateString(undefined, { weekday: "long" });
  const time = new Date(e.starts_at).toLocaleTimeString(undefined, { timeStyle: "short" });
  const rule = e.recurrence ? RECURRENCE_LABELS[e.recurrence] : "Recurring";
  if (e.recurrence === "monthly") {
    return `${rule} on ${day}s · ${time}`;
  }
  return `${rule} on ${day}s · ${time}`;
}

const EVENT_TYPES = [
  { value: "fnm",        label: "Friday Night Magic" },
  { value: "prerelease", label: "Pre-release" },
  { value: "draft",      label: "Draft" },
  { value: "commander",  label: "Commander" },
  { value: "standard",   label: "Standard" },
  { value: "modern",     label: "Modern" },
  { value: "pioneer",    label: "Pioneer" },
  { value: "legacy",     label: "Legacy" },
  { value: "vintage",    label: "Vintage" },
  { value: "other",      label: "Other" },
];

const darkSelect = "h-10 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-amber-500/50";
const darkTextarea = "w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StoreSettingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const { data, isLoading } = useQuery<Store>({
    queryKey: ["my-store"],
    queryFn: () => api.get("/store"),
    enabled: !!user,
    retry: false,
  });

  const { data: eventsData, isLoading: eventsLoading } = useQuery<{ data: StoreEvent[] }>({
    queryKey: ["my-store-events"],
    queryFn: () => api.get("/store/events"),
    enabled: !!user,
  });

  const [f, setF] = useState(emptyProfile);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<StoreEvent | null>(null);
  const [ev, setEv] = useState(emptyEvent);
  const [eventErr, setEventErr] = useState<string | null>(null);
  const [eventSaving, setEventSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setF({
        name: data.name ?? "",
        slug: data.slug ?? "",
        store_type: data.store_type ?? "personal",
        description: data.description ?? "",
        return_policy: data.return_policy ?? "",
        status: data.status ?? "active",
        phone: data.phone ?? "",
        email: data.email ?? "",
        website: data.website ?? "",
        address_line1: data.address_line1 ?? "",
        address_line2: data.address_line2 ?? "",
        address_city: data.address_city ?? "",
        address_region: data.address_region ?? "",
        address_postal_code: data.address_postal_code ?? "",
        address_country: data.address_country ?? "US",
        facebook_url: data.facebook_url ?? "",
        instagram_url: data.instagram_url ?? "",
        discord_url: data.discord_url ?? "",
        twitter_url: data.twitter_url ?? "",
        youtube_url: data.youtube_url ?? "",
        ship_from_recipient: data.ship_from_recipient ?? "",
        ship_from_line1: data.ship_from_line1 ?? "",
        ship_from_line2: data.ship_from_line2 ?? "",
        ship_from_city: data.ship_from_city ?? "",
        ship_from_region: data.ship_from_region ?? "",
        ship_from_postal_code: data.ship_from_postal_code ?? "",
        ship_from_country: data.ship_from_country ?? "US",
      });
    }
  }, [data]);

  if (loading || !user) return null;
  if (isLoading) return <p className="text-sm text-slate-400">Loading…</p>;

  const isLGS = f.store_type === "lgs";

  // ---------------------------------------------------------------------------
  // Profile save
  // ---------------------------------------------------------------------------

  async function saveProfile() {
    setSaving(true);
    setSaveErr(null);
    try {
      const body: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(f)) {
        body[k] = v.trim() === "" ? null : v.trim();
      }
      body["name"] = f.name.trim();
      body["store_type"] = f.store_type;
      await api.put<Store>("/store", body);
      qc.invalidateQueries({ queryKey: ["my-store"] });
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Event save
  // ---------------------------------------------------------------------------

  function openNewEvent() {
    setEditingEvent(null);
    setEv(emptyEvent);
    setEventErr(null);
    setShowEventForm(true);
  }

  function openEditEvent(e: StoreEvent) {
    setEditingEvent(e);
    setEv({
      title: e.title,
      description: e.description ?? "",
      event_type: e.event_type,
      starts_at: e.starts_at.slice(0, 16),
      ends_at: e.ends_at ? e.ends_at.slice(0, 16) : "",
      entry_fee_dollars: e.entry_fee_cents != null ? String(e.entry_fee_cents / 100) : "",
      max_players: e.max_players != null ? String(e.max_players) : "",
      is_recurring: e.is_recurring,
      recurrence: e.recurrence ?? "weekly",
    });
    setEventErr(null);
    setShowEventForm(true);
  }

  async function saveEvent() {
    setEventSaving(true);
    setEventErr(null);
    try {
      const payload = {
        title: ev.title.trim(),
        description: ev.description.trim() || null,
        event_type: ev.event_type,
        starts_at: ev.starts_at ? new Date(ev.starts_at).toISOString() : "",
        ends_at: ev.ends_at ? new Date(ev.ends_at).toISOString() : null,
        entry_fee_cents: ev.entry_fee_dollars ? Math.round(parseFloat(ev.entry_fee_dollars) * 100) : null,
        max_players: ev.max_players ? parseInt(ev.max_players, 10) : null,
        is_recurring: ev.is_recurring,
        recurrence: ev.is_recurring ? ev.recurrence : null,
      };
      if (editingEvent) {
        await api.put(`/store/events/${editingEvent.id}`, payload);
      } else {
        await api.post("/store/events", payload);
      }
      qc.invalidateQueries({ queryKey: ["my-store-events"] });
      setShowEventForm(false);
    } catch (e) {
      setEventErr((e as Error).message);
    } finally {
      setEventSaving(false);
    }
  }

  async function deleteEvent(id: string) {
    if (!confirm("Delete this event?")) return;
    await api.del(`/store/events/${id}`);
    qc.invalidateQueries({ queryKey: ["my-store-events"] });
  }

  // ---------------------------------------------------------------------------
  // Field helpers
  // ---------------------------------------------------------------------------

  const inp = (k: keyof typeof f, label: string, placeholder = "") => (
    <div className="space-y-1">
      <Label htmlFor={k} className="text-slate-300">{label}</Label>
      <Input
        id={k}
        value={f[k]}
        placeholder={placeholder}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
        className="border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus-visible:ring-amber-500/50"
      />
    </div>
  );

  type StringEvKey = { [K in keyof typeof emptyEvent]: typeof emptyEvent[K] extends string ? K : never }[keyof typeof emptyEvent];
  const evInp = (k: StringEvKey, label: string, type = "text", placeholder = "") => (
    <div className="space-y-1">
      <Label htmlFor={`ev-${k}`} className="text-slate-300">{label}</Label>
      <Input
        id={`ev-${k}`}
        type={type}
        value={ev[k]}
        placeholder={placeholder}
        onChange={(e) => setEv({ ...ev, [k]: e.target.value })}
        className="border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus-visible:ring-amber-500/50"
      />
    </div>
  );

  const events = eventsData?.data ?? [];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-8 pb-12 text-white">
      <h1 className="text-2xl font-semibold">Store settings</h1>

      {/* ── Store type ── */}
      <section className="space-y-3">
        <h2 className="font-medium text-white">Store type</h2>
        <div className="flex gap-3">
          {(["personal", "lgs"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setF({ ...f, store_type: t })}
              className={[
                "rounded-lg border px-5 py-3 text-sm font-medium transition-colors",
                f.store_type === t
                  ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                  : "border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white",
              ].join(" ")}
            >
              {t === "personal" ? "Personal seller" : "Local game store (LGS)"}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400">
          {isLGS
            ? "LGS stores can display contact info, a physical address, events, and social links on their public page."
            : "Personal sellers list cards from their own collection."}
        </p>
      </section>

      {/* ── Shop info ── */}
      <section className="space-y-3 border-t border-white/10 pt-6">
        <h2 className="font-medium text-white">Shop</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {inp("name", "Shop name *")}
          {inp("slug", "URL slug")}
        </div>
        {inp("description", isLGS ? "Short tagline" : "Description (one line)")}
        <div className="space-y-1">
          <Label htmlFor="return_policy" className="text-slate-300">Return policy</Label>
          <textarea
            id="return_policy"
            value={f.return_policy}
            onChange={(e) => setF({ ...f, return_policy: e.target.value })}
            rows={3}
            className={darkTextarea}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="status" className="text-slate-300">Status</Label>
          <select
            id="status"
            value={f.status}
            onChange={(e) => setF({ ...f, status: e.target.value })}
            className={`${darkSelect} w-40`}
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </section>

      {/* ── Contact (LGS) ── */}
      {isLGS && (
        <section className="space-y-3 border-t border-white/10 pt-6">
          <h2 className="font-medium text-white">Contact info</h2>
          <p className="text-xs text-slate-400">Displayed publicly on your store page.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {inp("phone", "Phone", "(555) 123-4567")}
            {inp("email", "Public email", "store@example.com")}
            {inp("website", "Website", "https://example.com")}
          </div>
        </section>
      )}

      {/* ── Physical address (LGS) ── */}
      {isLGS && (
        <section className="space-y-3 border-t border-white/10 pt-6">
          <h2 className="font-medium text-white">Store address</h2>
          <p className="text-xs text-slate-400">Your public storefront location.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {inp("address_line1", "Line 1")}
            {inp("address_line2", "Line 2 (suite, unit…)")}
            {inp("address_city", "City")}
            {inp("address_region", "State / region")}
            {inp("address_postal_code", "Postal code")}
            {inp("address_country", "Country (ISO-2)")}
          </div>
        </section>
      )}

      {/* ── Social links ── */}
      <section className="space-y-3 border-t border-white/10 pt-6">
        <h2 className="font-medium text-white">Social links</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {inp("facebook_url",  "Facebook",    "https://facebook.com/…")}
          {inp("instagram_url", "Instagram",   "https://instagram.com/…")}
          {inp("discord_url",   "Discord",     "https://discord.gg/…")}
          {inp("twitter_url",   "X / Twitter", "https://x.com/…")}
          {inp("youtube_url",   "YouTube",     "https://youtube.com/…")}
        </div>
      </section>

      {/* ── Ship from ── */}
      <section className="space-y-3 border-t border-white/10 pt-6">
        <h2 className="font-medium text-white">Ship from</h2>
        <p className="text-xs text-slate-400">
          The return address printed on every order shipped from your store.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {inp("ship_from_recipient", "Recipient / business name")}
          {inp("ship_from_line1", "Line 1")}
          {inp("ship_from_line2", "Line 2")}
          {inp("ship_from_city", "City")}
          {inp("ship_from_region", "State / region")}
          {inp("ship_from_postal_code", "Postal code")}
          {inp("ship_from_country", "Country (ISO-2)")}
        </div>
      </section>

      {saveErr && <p className="text-sm text-red-400">{saveErr}</p>}
      <Button
        onClick={saveProfile}
        disabled={saving}
        className="border border-amber-500/30 bg-amber-500 font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save settings"}
      </Button>

      {/* ── Events (LGS only) ── */}
      {isLGS && (
        <section className="space-y-4 border-t border-white/10 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium text-white">Events</h2>
              <p className="text-xs text-slate-400">
                Upcoming events shown publicly on your store page.
              </p>
            </div>
            <Button
              size="sm"
              onClick={openNewEvent}
              className="border border-amber-500/30 bg-amber-500 font-semibold text-black hover:bg-amber-400"
            >
              <Plus className="mr-1.5 h-4 w-4" /> Add event
            </Button>
          </div>

          {/* Event form */}
          {showEventForm && (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-4">
              <h3 className="text-sm font-medium text-white">
                {editingEvent ? "Edit event" : "New event"}
              </h3>
              <div className="flex items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={ev.is_recurring}
                    onChange={(e) => setEv({ ...ev, is_recurring: e.target.checked })}
                    className="h-4 w-4 rounded border-white/20 accent-amber-500"
                  />
                  Repeating event
                </label>
                {ev.is_recurring && (
                  <select
                    value={ev.recurrence}
                    onChange={(e) => setEv({ ...ev, recurrence: e.target.value })}
                    className={`h-9 ${darkSelect}`}
                  >
                    <option value="weekly">Every week</option>
                    <option value="biweekly">Every 2 weeks</option>
                    <option value="monthly">Monthly</option>
                  </select>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {evInp("title", "Title *", "text", "FNM Standard Showdown")}
                <div className="space-y-1">
                  <Label htmlFor="ev-event_type" className="text-slate-300">Event type</Label>
                  <select
                    id="ev-event_type"
                    value={ev.event_type}
                    onChange={(e) => setEv({ ...ev, event_type: e.target.value })}
                    className={`${darkSelect} w-full`}
                  >
                    {EVENT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  {evInp("starts_at", ev.is_recurring ? "First occurrence (sets day & time) *" : "Starts at *", "datetime-local")}
                </div>
                {evInp("ends_at", ev.is_recurring ? "End time each occurrence" : "Ends at", "datetime-local")}
                {evInp("entry_fee_dollars", "Entry fee ($)", "number", "0.00")}
                {evInp("max_players", "Max players", "number", "8")}
              </div>
              <div className="space-y-1">
                <Label htmlFor="ev-description" className="text-slate-300">Description</Label>
                <textarea
                  id="ev-description"
                  value={ev.description}
                  onChange={(e) => setEv({ ...ev, description: e.target.value })}
                  rows={2}
                  className={darkTextarea}
                  placeholder="Optional details…"
                />
              </div>
              {eventErr && <p className="text-sm text-red-400">{eventErr}</p>}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={saveEvent}
                  disabled={eventSaving}
                  className="border border-amber-500/30 bg-amber-500 font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
                >
                  {eventSaving ? "Saving…" : "Save event"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowEventForm(false)}
                  className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Event list */}
          {eventsLoading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-slate-400">No events yet.</p>
          ) : (
            <div className="divide-y divide-white/5 rounded-lg border border-white/10">
              {events.map((e) => (
                <div key={e.id} className="flex items-start gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-white">{e.title}</span>
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400 uppercase tracking-wide ring-1 ring-white/10">
                        {EVENT_TYPES.find((t) => t.value === e.event_type)?.label ?? e.event_type}
                      </span>
                      {e.is_recurring && (
                        <span className="rounded bg-blue-900/50 px-1.5 py-0.5 text-[10px] font-medium text-blue-300 uppercase tracking-wide ring-1 ring-blue-500/30">
                          {e.recurrence
                            ? ({ weekly: "Weekly", biweekly: "Every 2 wks", monthly: "Monthly" } as Record<string, string>)[e.recurrence] ?? "Recurring"
                            : "Recurring"}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">
                      {e.is_recurring
                        ? formatRecurringSchedule(e)
                        : new Date(e.starts_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      {e.ends_at && !e.is_recurring && ` – ${new Date(e.ends_at).toLocaleTimeString(undefined, { timeStyle: "short" })}`}
                      {e.is_recurring && e.ends_at && ` – ${new Date(e.ends_at).toLocaleTimeString(undefined, { timeStyle: "short" })}`}
                      {e.entry_fee_cents != null && ` · ${formatMoney(e.entry_fee_cents, e.currency)} entry`}
                      {e.max_players != null && ` · ${e.max_players} players max`}
                    </p>
                    {e.description && (
                      <p className="mt-0.5 text-xs text-slate-500 line-clamp-1">{e.description}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditEvent(e)}
                      className="text-slate-400 hover:text-white"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteEvent(e.id)}
                      className="text-slate-400 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
