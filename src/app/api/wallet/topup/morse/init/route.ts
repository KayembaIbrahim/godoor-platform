import { NextResponse } from "next/server";
import { z } from "zod";
import { createDeposit, GODOR_MORSE_USERNAME } from "@/lib/escrow";
import { authorize } from "@/lib/api-auth";
import { getServiceClient } from "@/lib/supabase-server";

const InitSchema = z.object({
  amount: z.coerce.number().int().positive().max(10_000_000),
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

  const parsed = InitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid amount in UGX." }, { status: 400 });
  }

  try {
    const deposit = await createDeposit(sb, {
      userId: actor.id,
      provider: "morse",
      amount: parsed.data.amount,
      currency: "UGX",
    });

    return NextResponse.json({
      data: {
        depositId: deposit.id,
        referenceCode: deposit.reference_code,
        amount: deposit.amount,
        currency: deposit.currency,
        status: deposit.status,
        morseUsername: GODOR_MORSE_USERNAME,
        instructions: [
          `Send exactly ${parsed.data.amount.toLocaleString()} UGX to Morse username: ${GODOR_MORSE_USERNAME}`,
          `Put this exact reference in the payment note: ${deposit.reference_code}`,
          `Then tap "I have sent" below.`,
        ].join("\n"),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not create deposit" },
      { status: 500 },
    );
  }
}
