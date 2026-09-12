import {NextResponse} from "next/server";

/// Liveness probe. Deliberately does not touch the database or the chain, so it reports whether
/// this process is up and nothing else.
export function GET() {
  return NextResponse.json({status: "ok", service: "cope-market-backend"});
}
