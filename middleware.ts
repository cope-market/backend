import {NextResponse} from "next/server";
import type {NextRequest} from "next/server";
import {allowedOrigins, corsHeaders} from "./lib/api-server/cors";

/// Adds cross-origin headers to the API, and answers preflights.
///
/// Middleware rather than something inside `defineHandler`, because a preflight is an OPTIONS
/// request that never reaches a route handler — there is no handler for it to reach. Doing it here
/// also means a route added later is covered without anyone remembering to cover it.

export const config = {matcher: "/api/:path*"};

export function middleware(request: NextRequest): NextResponse {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin, allowedOrigins());

  if (request.method === "OPTIONS") {
    // 204 with no body. A preflight is asking permission, not fetching anything, and answering it
    // with the route's own 405 is what makes a correctly-configured client look broken.
    const response = new NextResponse(null, {status: 204});
    for (const [header, value] of Object.entries(headers ?? {})) {
      response.headers.set(header, value);
    }
    return response;
  }

  const response = NextResponse.next();
  for (const [header, value] of Object.entries(headers ?? {})) {
    response.headers.set(header, value);
  }
  return response;
}
