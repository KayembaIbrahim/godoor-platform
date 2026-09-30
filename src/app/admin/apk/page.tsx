"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Upload, Check, AlertTriangle, FileDown, Loader2 } from "lucide-react";

/**
 * Admin: publish the Android APK.
 *
 * The landing page links the app, so the binary has to be publishable from the
 * admin portal. Uploads land in the public `apk` bucket and the current release
 * is recorded in app_settings, which is what the landing page reads to replace
 * its "Coming soon" badge with a real download.
 */

type Release = {
  version: string | null;
  url: string | null;
  size_bytes: number | null;
  uploaded_at: string | null;
  notes: string | null;
};

function formatSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminApkPage() {
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/apk", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { release?: Release }) => setRelease(d.release ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const publish = async () => {
    if (!file) {
      setMsg({ ok: false, text: "Choose an .apk file first." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("version", version);
      fd.append("notes", notes);
      const res = await fetch("/api/admin/apk", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || "Upload failed");
      setMsg({ ok: true, text: `Published ${(body as { release?: Release }).release?.version ?? ""}. The landing page now links this build.` });
      setFile(null);
      setVersion("");
      setNotes("");
      if (inputRef.current) inputRef.current.value = "";
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-lg font-semibold">App Release</h1>
        <span className="ml-auto text-[11px] text-muted">Publish the Android APK customers download</span>
      </div>

      {release?.url && (
        <div className="rounded-2xl border border-success/30 bg-success/5 p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-success">
            <Check className="h-4 w-4" /> Current release
          </p>
          <div className="mt-2 grid gap-1 text-[12px] text-muted sm:grid-cols-2">
            <span>Version: <span className="font-semibold text-fg">{release.version || "—"}</span></span>
            <span>Size: <span className="font-semibold text-fg">{formatSize(release.size_bytes)}</span></span>
            <span className="sm:col-span-2">
              Published:{" "}
              <span className="font-semibold text-fg">
                {release.uploaded_at ? new Date(release.uploaded_at).toLocaleString("en-UG") : "—"}
              </span>
            </span>
            {release.notes && <span className="sm:col-span-2">Notes: {release.notes}</span>}
          </div>
          <a
            href={release.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-go px-3 py-2 text-[11px] font-bold text-white transition hover:opacity-90"
          >
            <FileDown className="h-3.5 w-3.5" /> Download current APK
          </a>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-surface p-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Upload className="h-4 w-4 text-go" /> Upload new APK
        </p>
        <p className="mt-1 text-[11px] text-muted">
          Only <span className="font-mono">.apk</span> files, up to 150 MB. Publishing replaces the current
          release and updates the landing page automatically.
        </p>

        <div className="mt-3 space-y-2.5">
          <input
            ref={inputRef}
            type="file"
            accept=".apk,application/vnd.android.package-archive"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-elevated file:px-3 file:py-2 file:text-[11px] font-semibold file:text-fg"
          />
          <div className="grid gap-2.5 sm:grid-cols-2">
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="Version (e.g. 1.4.0)"
              className="rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2"
            />
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Release notes (optional)"
              className="rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2"
            />
          </div>

          {file && (
            <p className="text-[11px] text-muted">
              <span className="font-semibold text-fg">{file.name}</span> · {formatSize(file.size)}
            </p>
          )}

          <button
            type="button"
            onClick={publish}
            disabled={busy || !file}
            className="inline-flex items-center gap-1.5 rounded-xl bg-go px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {busy ? "Publishing…" : "Publish release"}
          </button>

          {msg && (
            <p
              className={`flex items-start gap-1.5 rounded-xl border p-3 text-[11px] ${
                msg.ok
                  ? "border-success/30 bg-success/5 text-success"
                  : "border-danger/30 bg-danger/5 text-danger"
              }`}
            >
              {!msg.ok && <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />}
              {msg.text}
            </p>
          )}
        </div>
      </div>

      {loading && <p className="py-6 text-center text-sm text-muted">Loading…</p>}
      {!loading && !release && (
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-[11px] text-muted">
          No release published yet. The landing page shows "Coming soon" until you upload one.
        </p>
      )}
    </div>
  );
}
