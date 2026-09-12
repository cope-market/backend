import {describe, expect, it} from "vitest";
import {fixtures} from "./fixtures";
import {routes} from "../api-schema/routes";

/// A fixture that does not satisfy its own schema is worse than no fixture: the client is built
/// against a shape the real server will never send.
describe("fixtures", () => {
  it("covers every route", () => {
    expect(Object.keys(fixtures).sort()).toEqual(Object.keys(routes).sort());
  });

  it.each(Object.keys(routes))("has a fixture matching the %s response schema", (name) => {
    const route = routes[name as keyof typeof routes];
    const result = route.response.safeParse(fixtures[name as keyof typeof fixtures]);
    expect(result.success ? null : result.error.message).toBeNull();
  });
});
