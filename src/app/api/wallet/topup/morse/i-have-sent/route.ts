import { NextResponse } from "next/server";
import { z } from "zod";
import { getDepositByReference } from "@/lib/escrow";
import { authorize } from "@/lib/api-auth";
import { getServiceClient } from "@/lib/supabase-server";

const SentSchema = z.object({
  referenceCode: z.string().min(4).max(40),
});

export async function POST(req: Request) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Wallet unavailable" }, { status: 503 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = SentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid reference code" }, { status: 400 });
  }

  const deposit = await getDepositByReference(sb, parsed.data.referenceCode);
  if (!deposit || deposit.user_id !== actor.id) {
    return NextResponse.json({ error: "Reference not found" }, { status: 404 });
  }
  if (deposit.status !== "pending") {
    return NextResponse.json({ error: `Deposit already ${deposit.status}` }, { status: 400 });
  }

  return NextResponse.json({
    data: {
      depositId: deposit.id,
      referenceCode: deposit.reference_code,
      amount: deposit.amount,
      status: deposit.status,
      message: "Received — the GoDoor team will verify the Morse transfer and credit your wallet shortly.",
    },
  });
}
