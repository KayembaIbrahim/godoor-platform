/**
 * Admin audit log — every money/status mutation by an admin is recorded.
 *
 * BACKED BY app_settings (already exists in production, no DDL needed).
 * Keys: audit:<iso>:<rand>
 * Value: { actor, action, target, meta, ip, at }
 *
 * WHY: the old admin was a single shared cookie — one cookie = full admin
 * with no trail. This module gives every admin action an identity + trail
 * without a new table, so it can ship today. When a proper audit_log
 * table is created, swap the store — callers never change.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditEntry = {
  actor: string;       // "admin:<name or email>" or the admin cookie identity
  action: string;      // e.g. "deposit.confirm", "merchant.suspend"
  target: string;      // id of the thing mutated
  meta?: Record<string, unknown>;
  ip?: string;
  at: string;
};

function rand(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** Record an admin action. Best-effort — never throws. */
export async function recordAudit(
  sb: SupabaseClient,
  entry: Omit<AuditEntry, "at">,
): Promise<void> {
  try {
    const at = new Date().toISOString();
    await sb.from("app_settings").upsert({
      key: `audit:${at}:${rand()}`,
      value: JSON.stringify({ ...entry, at }),
      updated_at: at,
    });
  } catch {}
}

export async function readAudit(sb: SupabaseClient, limit = 200): Promise<AuditEntry[]> {
  try {
    const { data } = await sb.from("app_settings")
      .select("key, value, updated_at")
      .like("key", "audit:%")
      .order("updated_at", { ascending: false })
      .limit(limit);
    return (data || []).map((r) => {
      try { return JSON.parse(r.value as string) as AuditEntry; }
      catch { return { actor: "?", action: "?", target: r.key, at: r.updated_at }; }
    });
  } catch { return []; }
}
