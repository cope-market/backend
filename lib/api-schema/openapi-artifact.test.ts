import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";
import {buildOpenApiDocument} from "./openapi";

/// The committed document is what clients generate from. If it drifts from the route registry, a
/// client is built against an API that does not exist.
describe("committed openapi.json", () => {
  it("matches what the registry generates", () => {
    const committed = JSON.parse(
      readFileSync(new URL("../../public/openapi.json", import.meta.url), "utf8"),
    );
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildOpenApiDocument())));
  });
});
