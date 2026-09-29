import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import { confirmDeposit, getDepositById } from "@/lib/escrow";

const ConfirmSchema = z.object({
  depositId: z.string().uuid(),
  providerTxId: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Valid depositId required" }, { status: 400 });
  }

  const deposit = await getDepositById(sb, parsed.data.depositId);
  if (!deposit) {
    return NextResponse.json({ error: "Deposit not found" }, { status: 404 });
  }
  if (deposit.status !== "pending") {
    return NextResponse.json({ error: `Deposit already ${deposit.status}` }, { status: 400 });
  }

  try {
    const result = await confirmDeposit(sb, parsed.data.depositId, parsed.data.providerTxId);
    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      depositId: parsed.data.depositId,
      amount: deposit.amount,
      referenceCode: deposit.reference_code,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not confirm deposit" },
      { status: 500 },
    );
  }
}
