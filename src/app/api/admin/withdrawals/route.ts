import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import {
  claimWithdrawalLock,
  creditWalletRefund,
  listAllWithdrawals,
  readWithdrawal,
  readWithdrawalConfig,
  releaseWithdrawalLock,
  saveWithdrawal,
  writeWithdrawalConfig,
  type WithdrawalConfig,
} from "@/lib/withdrawal";

/**
 * Admin withdrawal queue and fee controls.
 *
 * GoDoor pays withdrawals out by hand over Morse — the same reconciliation
 * model deposits already use, and the only honest one until an outbound
 * mobile-money API is connected. So this screen is the operational surface:
 * see what was requested, send the money, then mark it paid. Marking paid is
 * what tells the customer their money left; cancelling returns it to the
 * wallet and writes the compensating ledger row.
 *
 * Only a still-pending request can be decided, so a double click cannot pay
 * twice and a paid request cannot be silently reversed back into a debit.
 */

async function authed() {
  const jar = await cookies();
  return verifySession(jar.get(ADMIN_COOKIE)?.value || "");
}

const ConfigPatch = z.object({
  enabled: z.boolean().optional(),
  customer_fee_percent: z.coerce.number().min(0).max(50).optional(),
  rider_fee_percent: z.coerce.number().min(0).max(50).optional(),
  business_fee_percent: z.coerce.number().min(0).max(50).optional(),
  min_amount_ugx: z.coerce.number().int().min(0).max(10_000_000).optional(),
  max_amount_ugx: z.coerce.number().int().min(1).max(100_000_000).optional(),
  daily_limit_ugx: z.coerce.number().int().min(0).max(100_000_000).optional(),
  require_pin: z.boolean().optional(),
});

const Decision = z.object({
  id: z.string().min(1),
  action: z.enum(["paid", "cancelled"]),
  adminNote: z.string().max(280).optional().default(""),
});

export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const [config, all] = await Promise.all([readWithdrawalConfig(sb), listAllWithdrawals(sb, 200)]);
  return NextResponse.json({
    config,
    pending: all.filter((w) => w.status === "pending"),
    history: all.filter((w) => w.status !== "pending"),
    totals: {
      pendingNet: all.filter((w) => w.status === "pending").reduce((s, w) => s + w.net, 0),
      pendingFees: all.filter((w) => w.status === "pending").reduce((s, w) => s + w.fee, 0),
      paidNet: all.filter((w) => w.status === "paid").reduce((s, w) => s + w.net, 0),
      earnedFees: all.filter((w) => w.status === "paid").reduce((s, w) => s + w.fee, 0),
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
  const next: Partial<WithdrawalConfig> = parsed.data;
  if (
    typeof next.max_amount_ugx === "number" &&
    typeof next.min_amount_ugx === "number" &&
    next.max_amount_ugx < next.min_amount_ugx
  ) {
    return NextResponse.json({ error: "Maximum must be at least the minimum." }, { status: 400 });
  }
  return NextResponse.json({ config: await writeWithdrawalConfig(sb, next) });
}

/** Mark paid (money already sent) or cancel (return it to the wallet). */
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const parsed = Decision.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { id, action, adminNote } = parsed.data;

  const rec = await readWithdrawal(sb, id);
  if (!rec) return NextResponse.json({ error: "Withdrawal not found." }, { status: 404 });
  if (rec.status !== "pending") {
    return NextResponse.json(
      { error: `This withdrawal is already ${rec.status}.` },
      { status: 409 },
    );
  }

  // Serialise against a second decision landing at the same moment, so a
  // double click cannot both refund and mark paid.
  const locked = await claimWithdrawalLock(sb, rec.userId);
  if (!locked) {
    return NextResponse.json(
      { error: "Another operation is running for this account. Try again." },
      { status: 409 },
    );
  }

  try {
    const fresh = await readWithdrawal(sb, id);
    if (!fresh || fresh.status !== "pending") {
      return NextResponse.json({ error: "Already decided." }, { status: 409 });
    }

    if (action === "cancelled") {
      await creditWalletRefund(sb, fresh.userId, fresh.gross, fresh);
    }

    const next = {
      ...fresh,
      status: action,
      decidedAt: new Date().toISOString(),
      adminNote: String(adminNote || "").slice(0, 280),
    };
    await saveWithdrawal(sb, next);
    return NextResponse.json({ withdrawal: next });
  } finally {
    await releaseWithdrawalLock(sb, rec.userId);
  }
}
