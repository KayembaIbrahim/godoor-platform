import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import {
  claimTransferLocks,
  listAllTransfers,
  readTransfer,
  readTransferConfig,
  releaseTransferLocks,
  reverseTransferFunds,
  writeTransferConfig,
  type TransferConfig,
} from "@/lib/transfer";

/**
 * Admin transfer ledger and controls.
 *
 * Unlike withdrawals — which arrive as a queue of requests an operator settles
 * by hand — a P2P transfer completes the instant it is sent. There is nothing
 * to approve, so this screen is an *audit* surface: every movement between two
 * GoDoor accounts, both sides of each pair, searchable and reconcilable against
 * the two ledger rows the transfer wrote.
 *
 * The only write action is a reversal, for money sent to the wrong person. It
 * moves the balance back and writes its own compensating ledger pair, so a
 * reversed transfer is as auditable as the original — nothing is ever deleted.
 */

async function authed() {
  const jar = await cookies();
  return verifySession(jar.get(ADMIN_COOKIE)?.value || "");
}

const ConfigPatch = z.object({
  enabled: z.boolean().optional(),
  fee_percent: z.coerce.number().min(0).max(50).optional(),
  min_amount_ugx: z.coerce.number().int().min(0).max(10_000_000).optional(),
  max_amount_ugx: z.coerce.number().int().min(1).max(100_000_000).optional(),
  daily_limit_ugx: z.coerce.number().int().min(0).max(100_000_000).optional(),
  require_pin: z.boolean().optional(),
  show_recipient_name: z.boolean().optional(),
});

const Reversal = z.object({
  id: z.string().min(1),
  reason: z.string().min(4).max(280),
});

export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const [config, all] = await Promise.all([readTransferConfig(sb), listAllTransfers(sb, 300)]);

  const completed = all.filter((t) => t.status === "completed");
  const day = new Date().toISOString().slice(0, 10);

  return NextResponse.json({
    config,
    transfers: all,
    totals: {
      count: all.length,
      volume: completed.reduce((s, t) => s + t.net, 0),
      fees: completed.reduce((s, t) => s + t.fee, 0),
      todayVolume: completed
        .filter((t) => t.createdAt.slice(0, 10) === day)
        .reduce((s, t) => s + t.net, 0),
      reversed: all.filter((t) => t.status === "reversed").length,
    },
  });
}

/** Fee / limit controls. */
export async function PATCH(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const parsed = ConfigPatch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Those values are out of range." }, { status: 400 });
  }
  const next: Partial<TransferConfig> = parsed.data;
  if (
    typeof next.max_amount_ugx === "number" &&
    typeof next.min_amount_ugx === "number" &&
    next.max_amount_ugx < next.min_amount_ugx
  ) {
    return NextResponse.json({ error: "Maximum must be at least the minimum." }, { status: 400 });
  }
  return NextResponse.json({ config: await writeTransferConfig(sb, next) });
}

/** Reverse a completed transfer — money sent to the wrong account. */
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const parsed = Reversal.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Give a reason for the reversal." }, { status: 400 });
  }
  const { id, reason } = parsed.data;

  const rec = await readTransfer(sb, id);
  if (!rec) return NextResponse.json({ error: "Transfer not found." }, { status: 404 });
  if (rec.status === "reversed") {
    return NextResponse.json({ error: "That transfer is already reversed." }, { status: 409 });
  }

  /* Both parties are locked — the reversal touches each balance. */
  const parties = [rec.fromUserId, rec.toUserId];
  const locked = await claimTransferLocks(sb, parties);
  if (!locked) {
    return NextResponse.json(
      { error: "One of those accounts is busy with another payment. Try again." },
      { status: 409 },
    );
  }

  try {
    /* Re-read inside the lock so a reversal cannot race a newer movement. */
    const fresh = await readTransfer(sb, id);
    if (!fresh || fresh.status === "reversed") {
      return NextResponse.json({ error: "That transfer is already reversed." }, { status: 409 });
    }

    const done = await reverseTransferFunds(sb, fresh, reason);
    if (!done.ok) {
      return NextResponse.json({ error: done.error || "Could not reverse it." }, { status: 402 });
    }
    return NextResponse.json({ transfer: await readTransfer(sb, id) });
  } finally {
    await releaseTransferLocks(sb, parties);
  }
}