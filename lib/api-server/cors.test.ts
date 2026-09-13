import {describe, expect, it} from "vitest";
import {allowedOrigins, corsHeaders} from "./cors";

const LOCAL = "http://localhost:3000";
const DEPLOYED = "https://cope.example";

describe("reading the allowlist", () => {
  it("splits a comma-separated list", () => {
    expect(allowedOrigins({CORS_ALLOWED_ORIGINS: `${LOCAL},${DEPLOYED}`})).toEqual([
      LOCAL,
      DEPLOYED,
    ]);
  });

  it("tolerates spaces around entries", () => {
    expect(allowedOrigins({CORS_ALLOWED_ORIGINS: ` ${LOCAL} , ${DEPLOYED} `})).toEqual([
      LOCAL,
      DEPLOYED,
    ]);
  });

  /// Unset means no cross-origin access, not open access. A deployment that forgot to configure
  /// this should be closed rather than public.
  it("is empty when unset", () => {
    expect(allowedOrigins({})).toEqual([]);
    expect(allowedOrigins({CORS_ALLOWED_ORIGINS: ""})).toEqual([]);
  });

  it("drops empty entries from a trailing comma", () => {
    expect(allowedOrigins({CORS_ALLOWED_ORIGINS: `${LOCAL},`})).toEqual([LOCAL]);
  });
});

describe("building the headers", () => {
  it("echoes an allowed origin", () => {
    const headers = corsHeaders(LOCAL, [LOCAL, DEPLOYED]);
    expect(headers?.["access-control-allow-origin"]).toBe(LOCAL);
  });

  /// Without Vary, a shared cache can hand one origin the allow header issued for another.
  it("varies on Origin", () => {
    expect(corsHeaders(LOCAL, [LOCAL])?.["vary"]).toBe("Origin");
  });

  it("allows the authorization header, which is what makes a GET preflighted", () => {
    expect(corsHeaders(LOCAL, [LOCAL])?.["access-control-allow-headers"]).toContain(
      "authorization",
    );
  });

  it("refuses an origin that is not on the list", () => {
    expect(corsHeaders("https://evil.example", [LOCAL])).toBeNull();
  });

  /// A prefix or suffix test is how `http://localhost:3000.evil.example` gets in.
  it("matches exactly rather than by prefix or suffix", () => {
    expect(corsHeaders("http://localhost:3000.evil.example", [LOCAL])).toBeNull();
    expect(corsHeaders("http://evil.example/http://localhost:3000", [LOCAL])).toBeNull();
  });

  /// A different port is a different origin, and saying so is the point of the check.
  it("treats a different port as a different origin", () => {
    expect(corsHeaders("http://localhost:3001", [LOCAL])).toBeNull();
  });

  it("treats a different scheme as a different origin", () => {
    expect(corsHeaders("https://localhost:3000", [LOCAL])).toBeNull();
  });

  /// Same-origin and server-to-server callers send no Origin at all. They must keep working, and
  /// they need no header to do it.
  it("returns nothing for a request with no Origin", () => {
    expect(corsHeaders(null, [LOCAL])).toBeNull();
  });

  /// An unconfigured deployment allows nobody rather than everybody.
  it("allows nothing when the list is empty", () => {
    expect(corsHeaders(LOCAL, [])).toBeNull();
  });

  /// Never `*`: it cannot carry credentials, and it would let any page call this API with whatever
  /// token the visitor holds.
  it("never answers with a wildcard", () => {
    expect(corsHeaders(LOCAL, [LOCAL])?.["access-control-allow-origin"]).not.toBe("*");
  });
});
