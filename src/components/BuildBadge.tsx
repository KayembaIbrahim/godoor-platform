"use client";
import { useEffect, useState } from "react";

/**
 * Tiny build identifier, shown on every page.
 *
 * A Capacitor WebView caches JS aggressively, so after a deploy a user can keep
 * running an old bundle with no visible difference. This makes the running build
 * reportable, so "it still looks broken" can be answered with "you are on build
 * X" instead of a guess.
 */
export function BuildBadge() {
  const [commit, setCommit] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/build-id", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { commit?: string }) => { if (d?.commit) setCommit(d.commit); })
      .catch(() => {});
  }, []);

  if (!commit) return null;

  return (
    <span
      className="hidden select-none text-[9px] font-mono text-dim sm:inline"
      title={`Running build ${commit}`}
    >
      {commit}
    </span>
  );
}
