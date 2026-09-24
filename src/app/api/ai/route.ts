import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    reply: "GoDoor has been updated with a Help Desk! Visit /ai for frequently asked questions about ordering, payments, business management, and rider deliveries. For personalized support, email support@godoor.ug"
  });
}
