import { NextResponse } from "next/server";

/** Lets a user report exactly which build they are running, so a stale cache
 *  can be distinguished from a real bug instead of guessed at. */
export async function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_BUILD_ID || "";
  return NextResponse.json({
    commit: sha ? sha.slice(0, 7) : "local",
    full: sha || null,
    builtAt: process.env.BUILD_TIME || null,
  });
}
