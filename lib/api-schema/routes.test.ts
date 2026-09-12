import {describe, expect, it} from "vitest";
import {routeList, routes} from "./routes";
import {pathPlaceholders} from "./route";

/// These run at module load, so a malformed registry fails the suite rather than a request.

describe("route registry", () => {
  it("declares routes", () => {
    expect(routeList.length).toBeGreaterThan(20);
  });

  /// Swift code generation names its methods after operationId. A duplicate silently drops one.
  it("has a unique operationId per route", () => {
    const ids = routeList.map((r) => r.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names each registry key after its operationId", () => {
    for (const [key, route] of Object.entries(routes)) {
      expect(route.operationId).toBe(key);
    }
  });

  /// Two routes on the same method and path means one of them is unreachable.
  it("has a unique method and path per route", () => {
    const keys = routeList.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses paths relative to /api/v1, with no leading or trailing slash", () => {
    for (const route of routeList) {
      expect(route.path.startsWith("/"), route.operationId).toBe(false);
      expect(route.path.endsWith("/"), route.operationId).toBe(false);
      expect(route.path.includes("//"), route.operationId).toBe(false);
    }
  });

  it("gives every route a summary", () => {
    for (const route of routeList) {
      expect(route.summary.length, route.operationId).toBeGreaterThan(10);
    }
  });

  it("declares auth explicitly on every route", () => {
    for (const route of routeList) {
      expect(["required", "none"], route.operationId).toContain(route.auth);
    }
  });

  it("declares a params schema for every path placeholder", () => {
    for (const route of routeList) {
      const placeholders = pathPlaceholders(route.path);
      if (placeholders.length === 0) continue;
      expect(route.params, route.operationId).toBeDefined();
      expect(Object.keys(route.params!.shape).sort()).toEqual([...placeholders].sort());
    }
  });

  it("gives every mutating route a body schema", () => {
    for (const route of routeList) {
      if (route.method === "POST" || route.method === "PATCH") {
        expect(route.body, route.operationId).toBeDefined();
      }
    }
  });

  it("gives no GET a body", () => {
    for (const route of routeList) {
      if (route.method === "GET") expect(route.body, route.operationId).toBeUndefined();
    }
  });
});

/// The frontend reads these from the contracts. A route appearing here would mean the API had
/// started mirroring chain state, which is the thing this design avoids.
describe("routes the chain answers directly", () => {
  it.each([
    ["positions", /^positions$/],
    ["prices", /^prices/],
    ["balances", /balances/],
    ["liquidity vault state", /^lp/],
  ])("has no %s route", (_label, pattern) => {
    const matching = routeList.filter((r) => pattern.test(r.path));
    expect(matching.map((r) => r.operationId)).toEqual([]);
  });
});

describe("write routes are authenticated", () => {
  it("requires auth for every POST, PATCH and DELETE", () => {
    for (const route of routeList) {
      if (route.method === "GET") continue;
      expect(route.auth, route.operationId).toBe("required");
    }
  });
});
