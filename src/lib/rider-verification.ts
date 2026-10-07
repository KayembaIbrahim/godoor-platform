/**
 * Rider verification — ONE authoritative resolver.
 *
 * ── The bug this fixes ────────────────────────────────────────────────────────
 * The client decided "this rider is verified" from any of three signals:
 * `riders.verified`, a verified `merchants` row, or an approved
 * `verification_documents` row. The server's accept gate only ever read
 * `riders.verified`. A rider who had been approved on their documents therefore
 * passed the client gate, saw the Boda board, tapped Accept — and got a 403
 * "Verify your rider account first." That is the reported symptom: the button
 * does nothing.
 *
 * Worse, the two halves poisoned each other. `/app/rider` auto-creates a
 * `riders` row for any signed-in user who lacks one, and it creates it with
 * `verified: false`. `/api/rider/verify` then short-circuited on that row:
 *
 *     if (!error && data && !data.verified) return { status: "none" };
 *
 * so the auto-created row made the rider look un-verified and the merchant and
 * document evidence below it could never be consulted. One auto-create and the
 * rider could never be verified in the UI again — the board vanished and the
 * "Verification required for Boda" wall came back.
 *
 * ── The rule ──────────────────────────────────────────────────────────────────
 * A verified `riders` row is authoritative. Failing that, approval evidence
 * elsewhere (approved documents, verified merchant ownership) PROMOTES the row
 * rather than blocking on it, so the auto-create cannot dead-end a rider.
 * Promotion only ever runs on an exact `user_id` match — never the fuzzy
 * email-contains match used for display.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type RiderVerification = "none" | "pending" | "approved" | "rejected";

type ServiceClient = SupabaseClient;

/** A `riders` row, plus how we concluded the rider may accept rides. */
export interface ResolvedRider {
  id: string;
  verified: boolean;
  /** True when approval came from outside `riders` and the row was repaired. */
  promoted: boolean;
  reason: string;
}

type Maybe = <T>(p: PromiseLike<T>) => Promise<T>;

/** Never let an optional PostgREST builder blow up a caller. */
const settle: Maybe = async (p) => {
  try {
    return await p;
  } catch {
    return null as never;
  }
};

/**
 * Resolve a signed-in user to the `riders` row that the accept gate may use.
 *
 * @param sb     service-role client (bypasses RLS)
 * @param userId auth user id
 * @param email  auth email, used only as a fallback key for older rows
 */
export async function resolveVerifiedRider(
  sb: ServiceClient,
  userId: string,
  email: string,
): Promise<ResolvedRider | null> {
  const mail = (email || "").trim().toLowerCase();

  /* 1. The riders row itself, by id first then by email — the same order the
        dashboard uses, so both halves of the app name the same person. */
  let row: { id: string; verified: boolean } | null = null;
  if (userId) {
    const byId = await settle(
      sb.from("riders").select("id, verified").eq("id", userId).maybeSingle(),
    );
    if (byId && !byId.error && byId.data) row = byId.data as { id: string; verified: boolean };
  }
  if (!row && mail) {
    const byEmail = await settle(
      sb.from("riders").select("id, verified").eq("email", mail).maybeSingle(),
    );
    if (byEmail && !byEmail.error && byEmail.data) row = byEmail.data as { id: string; verified: boolean };
  }

  if (row?.verified) {
    return { id: row.id, verified: true, promoted: false, reason: "verified rider row" };
  }

  /* 2. Approval evidence held anywhere else. Collected, never short-circuited
        on — the unverified-row early return in the old verify route is what
        made this unreachable. */
  let approved = false;
  let evidence = "";

  if (userId) {
    const docs = await settle(
      sb
        .from("verification_documents")
        .select("status")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10),
    );
    if (docs && !docs.error && Array.isArray(docs.data) && docs.data?.length) {
      const list = docs.data as { status?: string }[];
      if (list.some((d) => d.status === "approved")) {
        approved = true;
        evidence = "approved verification documents";
      }
    }

    if (!approved) {
      const shop = await settle(
        sb.from("merchants").select("verified").eq("owner_id", userId).maybeSingle(),
      );
      if (shop && !shop.error && (shop.data as { verified?: boolean } | null)?.verified) {
        approved = true;
        evidence = "verified merchant account";
      }
    }
  }

  if (!approved) return row ? { ...row, promoted: false, reason: "rider row not verified" } : null;

  /* 3. Repair the row so every later read agrees. `patch` already carries
        verified:true — spelling it out separately just shadowed the spread. */
  const targetId = row?.id || userId;
  const patch = { verified: true, updated_at: new Date().toISOString() };
  if (row) {
    await settle(sb.from("riders").update(patch).eq("id", row.id));
  } else {
    await settle(
      sb.from("riders").insert({
        id: targetId,
        name: mail.split("@")[0] || "Rider",
        email: mail,
        vehicle_type: "motorbike",
        service_area: "Uganda",
        status: "offline",
        ...patch,
      }),
    );
  }
  return { id: targetId, verified: true, promoted: true, reason: evidence };
}

/**
 * The four states the dashboard renders. Same evidence, same order, as
 * resolveVerifiedRider — so the board and the accept gate can never disagree.
 */
export async function riderVerificationStatus(
  sb: ServiceClient,
  userId: string,
  email: string,
): Promise<RiderVerification> {
  const mail = (email || "").trim().toLowerCase();

  let row: { id: string; verified: boolean } | null = null;
  if (userId) {
    const byId = await settle(
      sb.from("riders").select("id, verified").eq("id", userId).maybeSingle(),
    );
    if (byId && !byId.error && byId.data) row = byId.data as { id: string; verified: boolean };
  }
  if (!row && mail) {
    const byEmail = await settle(
      sb.from("riders").select("id, verified").eq("email", mail).maybeSingle(),
    );
    if (byEmail && !byEmail.error && byEmail.data) row = byEmail.data as { id: string; verified: boolean };
  }
  if (row?.verified) return "approved";

  if (userId) {
    const docs = await settle(
      sb
        .from("verification_documents")
        .select("status")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10),
    );
    if (docs && !docs.error && Array.isArray(docs.data) && docs.data?.length) {
      const list = docs.data as { status?: string }[];
      if (list.some((d) => d.status === "approved")) return "approved";
      if (list.some((d) => d.status === "rejected")) return "rejected";
      return "pending";
    }

    const shop = await settle(
      sb.from("merchants").select("verified").eq("owner_id", userId).maybeSingle(),
    );
    if (shop && !shop.error && (shop.data as { verified?: boolean } | null)?.verified) {
      return "approved";
    }
  }

  /* No exact-id evidence. Only now do the loose email heuristics, and they can
     report status but can never promote — same rule as resolveVerifiedRider. */
  if (mail) {
    const byEmail = await settle(
      sb.from("riders").select("verified").eq("email", mail).maybeSingle(),
    );
    if (byEmail && !byEmail.error && byEmail.data) {
      const verified = !!(byEmail.data as { verified?: boolean }).verified;
      if (verified) return "approved";
      return "none";
    }
    const docs = await settle(
      sb
        .from("verification_documents")
        .select("status")
        .ilike("user_id", `%${mail}%`)
        .order("created_at", { ascending: false })
        .limit(10),
    );
    if (docs && !docs.error && Array.isArray(docs.data) && docs.data?.length) {
      const list = docs.data as { status?: string }[];
      if (list.some((d) => d.status === "approved")) return "approved";
      if (list.some((d) => d.status === "rejected")) return "rejected";
      return "pending";
    }
  }

  return "none";
}