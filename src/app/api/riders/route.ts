import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sb = getServiceClient();

  if (!sb) {
    return NextResponse.json({ rider: { id: "rider_" + Date.now(), ...body } });
  }

  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  // Rider identity is derived from the verified session — clients cannot
  // register (or verify) someone else's rider record.
  const id = actor.kind === "admin" ? String(body.id || "") : actor.id;
  const email = actor.kind === "admin" ? String(body.email || "") : (actor.email || "");

  try {
    const { data, error } = await sb
      .from("riders")
      .upsert({
        id,
        name: body.name || "",
        email,
        phone: body.phone || "",
        vehicle_type: body.vehicle_type || "motorbike",
        plate: body.plate || "",
        service_area: body.service_area || "Uganda",
        lat: Number(body.lat || 0),
        lng: Number(body.lng || 0),
        status: body.status === "online" ? "online" : "offline",
        // verified can only be granted by an admin, never self-applied
        verified: false,
        total_deliveries: 0,
        rating: 4.5,
      }, { onConflict: "id" })
      .select()
      .single();

    if (error) {
      // If table doesn't exist, return a local rider object
      if (error.message?.includes("does not exist") || error.code === "42P01") {
        return NextResponse.json({
          rider: { id, ...body, status: body.status === "online" ? "online" : "offline", verified: false, total_deliveries: 0, rating: 4.5 },
          warning: "Riders table not in Supabase. Running in local mode.",
        });
      }
      console.error("Create rider error:", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ rider: data });
  } catch (e: any) {
    console.error("Create rider crashed:", e);
    return NextResponse.json({ error: e?.message || "Rider registration failed" }, { status: 500 });
  }
}