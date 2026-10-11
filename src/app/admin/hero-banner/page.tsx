"use client";

import { useCallback, useEffect, useState } from "react";
import { Save, Eye, EyeOff, Loader2, ImageIcon, AlertTriangle } from "lucide-react";

import {
  HERO_AUDIENCES,
  scheduleSummary,
  type HeroAudience,
  type HeroBanner,
} from "@/lib/hero-banner-core";

/**
 * Sponsored homepage banner — real, persisted admin control.
 *
 * This is the slot businesses pay for, so every field in the brief is editable
 * here and takes effect without a deploy: image, headline, subtitle, button
 * label and destination, plus a schedule and an audience.
 *
 * Everything writes to `/api/admin/hero-banner`, which validates the WHOLE list
 * before replacing it. A partial write would leave the portal showing a banner
 * the database does not contain — which, for a paid slot, is a support call and
 * a refund.
 */

type Draft = {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  ctaLabel: string;
  ctaUrl: string;
  enabled: boolean;
  startsAt: string;
  endsAt: string;
  priority: number;
  audience: HeroAudience;
};

const BLANK: Draft = {
  id: "home-hero",
  title: "",
  subtitle: "",
  imageUrl: "",
  ctaLabel: "Order now",
  ctaUrl: "/app",
  enabled: false,
  startsAt: "",
  endsAt: "",
  priority: 0,
  audience: "customer",
};

/** `<input type="datetime-local">` wants `YYYY-MM-DDTHH:mm`, in LOCAL time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDraft(b: HeroBanner): Draft {
  return {
    id: b.id,
    title: b.title,
    subtitle: b.subtitle,
    imageUrl: b.imageUrl ?? "",
    ctaLabel: b.ctaLabel ?? "",
    ctaUrl: b.ctaUrl ?? "",
    enabled: b.enabled,
    startsAt: toLocalInput(b.startsAt),
    endsAt: toLocalInput(b.endsAt),
    priority: b.priority,
    audience: b.audience,
  };
}

export default function AdminHeroBannerPage() {
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/hero-banner", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) {
        setErr(d?.error ?? "Could not load");
        return;
      }
      const first = Array.isArray(d.banners) ? d.banners[0] : null;
      setDraft(first ? toDraft(first) : BLANK);
    } catch {
      setErr("Could not load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await fetch("/api/admin/hero-banner", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          banners: [
            {
              ...draft,
              imageUrl: draft.imageUrl.trim() || null,
              ctaUrl: draft.ctaUrl.trim() || null,
              ctaLabel: draft.ctaLabel.trim() || null,
              startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : null,
              endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
            },
          ],
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErr(d?.error ?? "Save failed");
        return;
      }
      setMsg("Saved. The customer home updates within a minute.");
      load();
    } catch {
      setErr("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const live = draft.enabled;
  const schedule = scheduleSummary(
    {
      ...BLANK,
      title: draft.title || "x",
      enabled: true,
      startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : null,
      endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
    } as HeroBanner,
    Date.now(),
  );

  if (loading) {
    return (
      <div className="p-6 text-center text-sm text-muted">
        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 md:p-6">
      <header>
        <h1 className="font-display text-xl font-bold">Sponsored banner</h1>
        <p className="mt-1 text-sm text-muted leading-relaxed">
          The large card at the top of the customer home. Businesses pay to appear here.
          Everything saves live — no deploy needed.
        </p>
      </header>

      {/* Live preview, because "is my headline going to fit?" is the question
          an admin actually has, and answering it needs the real card. */}
      <section className="rounded-2xl border border-border bg-surface p-4">
        <p className="navy-label mb-2">Preview</p>
        <div className="relative isolate overflow-hidden rounded-2xl bg-ink">
          {draft.imageUrl.trim() && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={draft.imageUrl.trim()} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/45" />
            </>
          )}
          <div className="relative p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-go">Featured</p>
            <p className="mt-1 font-display text-lg font-bold leading-tight text-on-ink">
              {draft.title || "Your headline appears here"}
            </p>
            {draft.subtitle && (
              <p className="mt-1 text-sm text-on-ink-muted">{draft.subtitle}</p>
            )}
            {draft.ctaLabel.trim() && (
              <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-go px-4 py-2.5 text-sm font-bold text-white">
                {draft.ctaLabel}
              </span>
            )}
          </div>
        </div>
        {!draft.imageUrl.trim() && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted">
            <ImageIcon className="mt-px h-3 w-3 shrink-0" />
            No image set — the banner renders as a solid ink card, which still looks intentional.
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-semibold">Show the banner</span>
            <span className="block text-xs text-muted">
              Off means the slot collapses and the categories move back up.
            </span>
          </span>
          <button
            type="button"
            onClick={() => set("enabled", !draft.enabled)}
            aria-pressed={draft.enabled}
            aria-label={draft.enabled ? "Hide banner" : "Show banner"}
            className={`chip chip-nav shrink-0 transition active:scale-95 ${draft.enabled ? "chip-on" : "bg-elevated text-muted"}`}
          >
            {draft.enabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {draft.enabled ? "Live" : "Hidden"}
          </button>
        </label>

        <label className="block">
          <span className="navy-label">Headline</span>
          <input
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            maxLength={90}
            placeholder="First order 20% off"
            className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-go/50"
          />
          <span className="mt-0.5 block text-[10px] text-muted">{draft.title.length}/90</span>
        </label>

        <label className="block">
          <span className="navy-label">Subtitle</span>
          <input
            value={draft.subtitle}
            onChange={(e) => set("subtitle", e.target.value)}
            maxLength={160}
            placeholder="Escrow protected · Free delivery"
            className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-go/50"
          />
          <span className="mt-0.5 block text-[10px] text-muted">{draft.subtitle.length}/160</span>
        </label>

        <label className="block">
          <span className="navy-label">Image URL</span>
          <input
            value={draft.imageUrl}
            onChange={(e) => set("imageUrl", e.target.value)}
            placeholder="https://…/banner.jpg"
            className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-go/50"
          />
          <span className="mt-0.5 block text-[10px] text-muted">
            Must be an https:// image. A light photo is dimmed automatically so the text stays readable.
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="navy-label">Button label</span>
            <input
              value={draft.ctaLabel}
              onChange={(e) => set("ctaLabel", e.target.value)}
              maxLength={28}
              placeholder="Order now"
              className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-go/50"
            />
          </label>
          <label className="block">
            <span className="navy-label">Button link</span>
            <input
              value={draft.ctaUrl}
              onChange={(e) => set("ctaUrl", e.target.value)}
              placeholder="/app or https://…"
              className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-go/50"
            />
          </label>
        </div>
        {(draft.ctaLabel.trim() && !draft.ctaUrl.trim()) && (
          <p className="flex items-start gap-1.5 text-[11px] text-warning">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
            A button with no link is dropped — no control is rendered.
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        <p className="navy-label">Schedule &amp; audience</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-fg">Starts</span>
            <input
              type="datetime-local"
              value={draft.startsAt}
              onChange={(e) => set("startsAt", e.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-go/50"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-fg">Ends</span>
            <input
              type="datetime-local"
              value={draft.endsAt}
              onChange={(e) => set("endsAt", e.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-go/50"
            />
          </label>
        </div>
        {schedule && (
          <p className="text-[11px] text-muted">
            {schedule}. The banner withdraws itself when the window closes, even on a phone that
            was left open.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-fg">Audience</span>
            <select
              value={draft.audience}
              onChange={(e) => set("audience", e.target.value as HeroAudience)}
              className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-go/50"
            >
              {HERO_AUDIENCES.map((a) => (
                <option key={a} value={a}>{a === "all" ? "Everyone" : a}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-fg">Priority</span>
            <input
              type="number"
              min={0}
              max={999}
              value={draft.priority}
              onChange={(e) => set("priority", Number(e.target.value) || 0)}
              className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-go/50"
            />
          </label>
        </div>
        <p className="text-[11px] text-muted">
          Higher priority wins when two slots overlap. Only one banner shows at a time.
        </p>
      </section>

      {err && (
        <p className="flex items-start gap-1.5 rounded-xl bg-danger/10 p-3 text-xs text-danger">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          {err}
        </p>
      )}
      {msg && <p className="rounded-xl bg-success/10 p-3 text-xs text-success">{msg}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !draft.title.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-go-2 active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save banner
        </button>
        {!draft.title.trim() && (
          <span className="text-[11px] text-muted">A headline is required.</span>
        )}
      </div>
      {!live && draft.title.trim() && (
        <p className="text-[11px] text-muted">
          Saved but hidden — the slot is collapsed until you switch &ldquo;Show the banner&rdquo; on.
        </p>
      )}
    </div>
  );
}