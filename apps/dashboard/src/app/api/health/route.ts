import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness endpoint for the private Compose service and the reverse proxy. */
export function GET(): NextResponse {
  return NextResponse.json(
    { status: "ok" },
    { headers: { "cache-control": "no-store" } },
  );
}
