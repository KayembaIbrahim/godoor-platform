import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize } from "@/lib/api-auth";
export const runtime = "edge";

// NOTE: do NOT import from "@/lib/web-push-client" here. That module is
// "use client", so importing it into a route handler produces a client
// reference, and *calling* one on the server throws. Production then returns
// an empty-bodied 500, which the browser surfaced as the opaque
// "Could not save the subscription". The worker is registered by the browser
// in `subscribeToPush()` before it calls this endpoint, so the server has
// nothing to register anyway.

const SubscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
  p256dh: z.string().min(10).max(500),
  auth: z.string().min(4).max(500),
});

/**
 * Stores / removes a browser push subscription for the signed-in user.
 *
 * The endpoint is a capability URL: whoever holds it can wake that browser, so
 * it is never returned to the client and the table is service_role-only.
 */
export async function POST(req: Request) {
  try {
    const actor = await authorize(req);
    if (!actor || actor.kind !== "user") {
      return NextResponse.json({ error: "Sign in to enable notifications" }, { status: 401 });
    }
    const sb = getServiceClient();
    if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

    const body = await req.json().catch(() => null);
    const parsed = SubscribeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }

    const { endpoint, p256dh, auth } = parsed.data;

    const { error } = await sb.from("push_subscriptions").upsert(
      {
        user_id: actor.id,
        endpoint,
        p256dh,
        auth,
        user_agent: req.headers.get("user-agent") || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    // An uncaught throw here used to surface as an empty-bodied 500, which the
    // browser could only report as "Could not save the subscription".
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const actor = await authorize(req);
    if (!actor || actor.kind !== "user") {
      return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
    }
    const sb = getServiceClient();
    if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

    const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
    if (!body.endpoint) {
      return NextResponse.json({ error: "endpoint required" }, { status: 400 });
    }

    // Scoped by user_id as well as endpoint: a user may only remove their own row.
    const { error } = await sb
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", body.endpoint)
      .eq("user_id", actor.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
