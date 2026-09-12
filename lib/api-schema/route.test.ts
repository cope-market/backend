import {describe, expect, it} from "vitest";
import {z} from "zod";
import {buildPath, defineRoute, pathPlaceholders} from "./route";

describe("pathPlaceholders", () => {
  it("finds every placeholder in declaration order", () => {
    expect(pathPlaceholders("theses/{thesisId}/comments/{commentId}")).toEqual([
      "thesisId",
      "commentId",
    ]);
  });

  it("returns an empty list for a static path", () => {
    expect(pathPlaceholders("feed")).toEqual([]);
  });
});

describe("defineRoute", () => {
  const ok = z.object({ok: z.boolean()});

  it("returns the definition it was given", () => {
    const route = defineRoute({
      method: "GET",
      path: "feed",
      operationId: "getFeed",
      summary: "Ranked feed",
      auth: "none",
      response: ok,
    });
    expect(route.method).toBe("GET");
    expect(route.path).toBe("feed");
    expect(route.operationId).toBe("getFeed");
  });

  /// A placeholder with no schema behind it is a route whose parameter is never validated. The
  /// handler would read an unchecked string straight out of the URL.
  it("rejects a path placeholder with no params schema", () => {
    expect(() =>
      defineRoute({
        method: "GET",
        path: "theses/{id}",
        operationId: "getThesis",
        summary: "Read a thesis",
        auth: "none",
        response: ok,
      }),
    ).toThrow(/declares placeholders.*id/i);
  });

  /// The mismatch that matters in practice: a path renamed without the schema following it.
  it("rejects params that do not match the placeholders", () => {
    expect(() =>
      defineRoute({
        method: "GET",
        path: "theses/{thesisId}",
        operationId: "getThesis",
        summary: "Read a thesis",
        auth: "none",
        params: z.object({id: z.string()}),
        response: ok,
      }),
    ).toThrow(/thesisId/);
  });

  it("accepts params that match the placeholders", () => {
    const route = defineRoute({
      method: "GET",
      path: "theses/{thesisId}",
      operationId: "getThesis",
      summary: "Read a thesis",
      auth: "none",
      params: z.object({thesisId: z.string()}),
      response: ok,
    });
    expect(route.path).toBe("theses/{thesisId}");
  });

  it("rejects a body on GET", () => {
    expect(() =>
      defineRoute({
        method: "GET",
        path: "feed",
        operationId: "getFeed",
        summary: "Ranked feed",
        auth: "none",
        body: z.object({x: z.string()}),
        response: ok,
      }),
    ).toThrow(/GET/);
  });
});

describe("buildPath", () => {
  const route = defineRoute({
    method: "GET",
    path: "users/{handle}/positions/{tokenId}",
    operationId: "getUserPosition",
    summary: "One position",
    auth: "none",
    params: z.object({handle: z.string(), tokenId: z.string()}),
    response: z.object({ok: z.boolean()}),
  });

  it("substitutes every placeholder", () => {
    expect(buildPath(route, {handle: "alice", tokenId: "7"})).toBe("users/alice/positions/7");
  });

  /// A handle can contain characters that change the meaning of a URL. Encoding is not optional.
  it("percent-encodes values", () => {
    expect(buildPath(route, {handle: "a/b", tokenId: "1 2"})).toBe("users/a%2Fb/positions/1%202");
  });
});
