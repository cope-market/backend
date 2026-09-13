/// Cross-origin access for the API.
///
/// The client is served from a different origin than this API — a teammate's localhost against a
/// tunnelled dev server, and later a deployed frontend against a deployed backend. Every request
/// carries an `authorization` header, which makes even a GET preflighted, so without this the
/// browser refuses the call before it is ever sent.

/// An allowlist rather than `*`.
///
/// `*` cannot be combined with credentials, and more importantly it would let any page on the
/// internet call this API with whatever token the visitor happens to hold. The set of origins that
/// may talk to a given deployment is small and known, so it is configuration.
export function allowedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env["CORS_ALLOWED_ORIGINS"];
  if (!raw) return [];
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export interface CorsHeaders {
  [header: string]: string;
}

/// Headers for a request from `origin`, or null when it is not allowed.
///
/// Returning null rather than throwing: a disallowed origin gets a normal response without the
/// header, and the browser is the thing that blocks it. That is how CORS is specified to work, and
/// it keeps a same-origin or server-to-server caller — neither of which sends `Origin` — working
/// untouched.
export function corsHeaders(origin: string | null, allowed: string[]): CorsHeaders | null {
  if (origin === null) return null;

  // Exact match. A prefix or suffix test here is how `evil-localhost:3000.example.com` gets in.
  if (!allowed.includes(origin)) return null;

  return {
    "access-control-allow-origin": origin,
    // Tells a cache that the response body depends on the request's Origin. Without it a shared
    // cache can serve one origin's allow header to another origin.
    vary: "Origin",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-max-age": "86400",
  };
}
