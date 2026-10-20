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
  // Guard the whole thing behind mount. On the server (and the very first
  // client render) `commit` is null, so we return `null` too — an identical
  // output keeps React happy during hydration. Only after the client mounts do
  // we fetch the running build id and swap the empty placeholder for the badge.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    fetch("/api/build-id", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { commit?: string }) => { if (d?.commit) setCommit(d.commit); })
      .catch(() => {});
  }, []);

  if (!mounted || !commit) return null;

  return (
    <span
      className="hidden select-none text-[9px] font-mono text-dim sm:inline"
      title={`Running build ${commit}`}
    >
      {commit}
    </span>
  );
}
