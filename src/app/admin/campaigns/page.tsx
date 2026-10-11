"use client";

import { useCallback, useEffect, useState } from "react";
import { Megaphone, Plus, Trash2, Save, Loader2, Eye, EyeOff, ImageIcon } from "lucide-react";
import {
  slugify,
  type Campaign,
  type CampaignAudience,
  type CampaignTone,
} from "@/lib/campaigns-core";
import { FLYER_TONES } from "@/components/FlyerPopup";

/**
 * Flyer popup controller.
 *
 * Deliberately separate from /admin/promos, which is promo *codes* — discount
 * codes applied at checkout. This is what interrupts the user, so it needs its
 * own controls: who sees it, when it runs, how long a dismissal lasts, and how
 * far it may outrank another campaign.
 *
 * The settings here are deliberately conservative by default — 7-day dismissal
 * window, priority 0, no schedule — because the failure mode of an over-eager
 * popup is not a bug report, it is uninstalls.
 */

const TONE_LABEL: Record<CampaignTone, string> = {
  brand: "GoDoor orange",
  navy: "Deep navy",
  purple: "Purple",
  success: "Green",
  gold: "Gold",
};

const AUDIENCE_LABEL: Record<CampaignAudience, string> = {
  all: "Everyone",
  customer: "Customers",
  rider: "Riders",
  business: "Businesses",
};

type Draft = Omit<Campaign, "updatedAt">;

const BLANK: Draft = {
  id: "",
  title: "",
  body: "",
  imageUrl: null,
  ctaLabel: null,
  ctaUrl: null,
  tone: "brand",
  audience: "all",
  enabled: true,
  startsAt: null,
  endsAt: null,
  priority: 0,
  dismissDays: 7,
};

/** `datetime-local` needs `YYYY-MM-DDTHH:mm`, not an ISO string with a Z. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** What the user would actually see right now. */
function liveState(c: Campaign): { label: string; ok: boolean } {
  const now = new Date().toISOString();
  if (!c.enabled) return { label: "Paused", ok: false };
  if (c.startsAt && now < c.startsAt) return { label: "Scheduled", ok: false };
  if (c.endsAt && now >= c.endsAt) return { label: "Finished", ok: false };
  return { label: "Live now", ok: true };
}

export default function AdminCampaignsPage() {
  const [items, setItems] = useState<Campaign[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/campaigns", { cache: "no-store" });
      if (!res.ok) return;
      const b = await res.json();
      setItems(Array.isArray(b.campaigns) ? b.campaigns : []);
    } catch {
      setError("Could not load campaigns.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (next: Campaign[]) => {
      setSaving(true);
      setError("");
      setSaved(false);
      try {
        const res = await fetch("/api/admin/campaigns", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ campaigns: next }),
        });
        const b = await res.json().catch(() => null);
        if (!res.ok) {
          setError(b?.error || "Could not save.");
          return;
        }
        setItems(b.campaigns ?? next);
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      } catch {
        setError("Network problem. Try again.");
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  /* ── Actions ───────────────────────────────────────────────────────────── */

  const addNew = () => {
    setDraft({ ...BLANK });
    setError("");
  };

  const commitDraft = () => {
    if (!draft) return;
    const id = slugify(draft.id || draft.title);
    if (!id) {
      setError("Give it a title or an id.");
      return;
    }
    const campaign: Campaign = {
      ...draft,
      id,
      imageUrl: draft.imageUrl?.trim() || null,
      ctaLabel: draft.ctaLabel?.trim() || null,
      ctaUrl: draft.ctaUrl?.trim() || null,
      updatedAt: new Date().toISOString(),
    };
    if (items && items.some((c) => c.id === id)) {
      setError(`"${id}" already exists. Pick another id.`);
      return;
    }
    void save([...(items ?? []), campaign]);
    setDraft(null);
  };

  const patch = (id: string, changes: Partial<Campaign>) => {
    if (!items) return;
    void save(items.map((c) => (c.id === id ? { ...c, ...changes, updatedAt: new Date().toISOString() } : c)));
  };

  const remove = (id: string) => {
    if (!items) return;
    void save(items.filter((c) => c.id !== id));
  };

  const move = (id: string, dir: -1 | 1) => {
    if (!items) return;
    const list = [...items];
    const i = list.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    void save(list);
  };

  /* ── Render ────────────────────────────────────────────────────────────── */

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-xl font-bold">
            <Megaphone className="h-5 w-5 text-go" />
            Flyer Popups
          </h1>
          <p className="mt-1 text-sm text-muted">
            A centred card for announcements and promotions. The close button appears after 3 seconds,
            and a dismissal is remembered for the window you choose.
          </p>
        </div>
        {!draft ? (
          <button type="button" onClick={addNew} className="btn btn-primary btn-sm">
            <Plus className="h-4 w-4" /> New campaign
          </button>
        ) : null}
      </header>

      {error ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          Saved. It appears on the app within about 30 seconds.
        </p>
      ) : null}

      {/* ── Editor ──────────────────────────────────────────────────────── */}
      {draft ? (
        <section className="gd-panel space-y-4 rounded-2xl border border-border bg-surface p-4">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-muted">New campaign</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">Title</span>
              <input
                value={draft.title}
                onChange={(e) => set("title", e.target.value)}
                maxLength={120}
                placeholder="Free delivery this week"
                className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-go"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">
                Id <span className="font-normal">(blank = from the title)</span>
              </span>
              <input
                value={draft.id}
                onChange={(e) => set("id", e.target.value)}
                placeholder="free-delivery-oct"
                className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-go"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted">Message</span>
            <textarea
              value={draft.body}
              onChange={(e) => set("body", e.target.value)}
              maxLength={600}
              rows={3}
              placeholder="Order over 30,000 and delivery is on us. Ends Sunday."
              className="w-full resize-y rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-go"
            />
          </label>

          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted">
              <ImageIcon className="h-3.5 w-3.5" /> Flyer image URL
            </span>
            <input
              value={draft.imageUrl ?? ""}
              onChange={(e) => set("imageUrl", e.target.value || null)}
              placeholder="https://… or /flyers/offer.jpg"
              className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-go"
            />
            <span className="mt-1 block text-[11px] text-muted">
              Paste the hosted flyer image URL. Leave blank for a plain gradient card.
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">Button label</span>
              <input
                value={draft.ctaLabel ?? ""}
                onChange={(e) => set("ctaLabel", e.target.value || null)}
                maxLength={40}
                placeholder="Order now"
                className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-go"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">Button link</span>
              <input
                value={draft.ctaUrl ?? ""}
                onChange={(e) => set("ctaUrl", e.target.value || null)}
                placeholder="/app or https://…"
                className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-go"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">Colour</span>
              <select
                value={draft.tone}
                onChange={(e) => set("tone", e.target.value as CampaignTone)}
                className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-go"
              >
                {(Object.keys(TONE_LABEL) as CampaignTone[]).map((t) => (
                  <option key={t} value={t}>{TONE_LABEL[t]}</option>
                ))}
              </select>
              <span
                className="mt-2 block h-6 rounded-lg"
                style={{ background: FLYER_TONES[draft.tone] }}
                aria-hidden="true"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">Who sees it</span>
              <select
                value={draft.audience}
                onChange={(e) => set("audience", e.target.value as CampaignAudience)}
                className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-go"
              >
                {(Object.keys(AUDIENCE_LABEL) as CampaignAudience[]).map((a) => (
                  <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">Starts <span className="font-normal">(blank = now)</span></span>
              <input
                type="datetime-local"
                value={toLocalInput(draft.startsAt)}
                onChange={(e) => set("startsAt", fromLocalInput(e.target.value))}
                className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-go"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">Ends <span className="font-normal">(blank = never)</span></span>
              <input
                type="datetime-local"
                value={toLocalInput(draft.endsAt)}
                onChange={(e) => set("endsAt", fromLocalInput(e.target.value))}
                className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-go"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">
                Priority <span className="font-normal">(higher wins when two run together)</span>
              </span>
              <input
                type="number"
                value={draft.priority}
                onChange={(e) => set("priority", Number(e.target.value))}
                min={-100}
                max={100}
                className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-go"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">
                Remember a dismissal for (days) <span className="font-normal">(0 = forever)</span>
              </span>
              <input
                type="number"
                value={draft.dismissDays}
                onChange={(e) => set("dismissDays", Number(e.target.value))}
                min={0}
                max={365}
                className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-go"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={commitDraft} disabled={saving} className="btn btn-primary btn-sm">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Publish
            </button>
            <button type="button" onClick={() => setDraft(null)} className="btn btn-ghost btn-sm">
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {/* ── List ────────────────────────────────────────────────────────── */}
      {items === null ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading campaigns…
        </p>
      ) : items.length === 0 ? (
        <div className="gd-panel rounded-2xl border border-border bg-surface p-8 text-center">
          <Megaphone className="mx-auto h-8 w-8 text-muted" />
          <p className="mt-2 font-display text-sm font-bold">No campaigns yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Nothing is interrupting the app right now. Create one when you have a flyer or an
            announcement to run.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((c, i) => {
            const state = liveState(c);
            return (
              <li key={c.id} className="gd-panel rounded-2xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div
                    className="h-11 w-11 shrink-0 rounded-xl"
                    style={{ background: FLYER_TONES[c.tone] }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-display text-sm font-bold">{c.title || c.id}</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          state.ok ? "bg-success/15 text-success" : "bg-elevated text-muted"
                        }`}
                      >
                        {state.label}
                      </span>
                      <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted">
                        {AUDIENCE_LABEL[c.audience]}
                      </span>
                      {c.priority !== 0 ? (
                        <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted">
                          priority {c.priority}
                        </span>
                      ) : null}
                    </div>
                    {c.body ? <p className="mt-1 line-clamp-2 text-sm text-muted">{c.body}</p> : null}
                    <p className="mt-1 text-[11px] text-muted">
                      <code className="opacity-80">{c.id}</code>
                      {" · "}dismiss {c.dismissDays === 0 ? "forever" : `${c.dismissDays}d`}
                      {c.startsAt ? ` · from ${new Date(c.startsAt).toLocaleString()}` : ""}
                      {c.endsAt ? ` · until ${new Date(c.endsAt).toLocaleString()}` : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => patch(c.id, { enabled: !c.enabled })}
                      disabled={saving}
                      aria-label={c.enabled ? `Pause ${c.title || c.id}` : `Enable ${c.title || c.id}`}
                      className="btn btn-ghost btn-sm"
                    >
                      {c.enabled ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      <span className="hidden sm:inline">{c.enabled ? "Pause" : "Enable"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => move(c.id, -1)}
                      disabled={saving || i === 0}
                      aria-label="Move up"
                      className="btn btn-ghost btn-sm"
                    >
                      <span aria-hidden="true">↑</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => move(c.id, 1)}
                      disabled={saving || i === items.length - 1}
                      aria-label="Move down"
                      className="btn btn-ghost btn-sm"
                    >
                      <span aria-hidden="true">↓</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(c.id)}
                      disabled={saving}
                      aria-label={`Delete ${c.title || c.id}`}
                      className="btn btn-danger btn-sm"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
