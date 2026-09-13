import {describe, expect, it} from "vitest";
import {buildOpenApiDocument} from "./openapi";
import {needsToken} from "./route";
import {routeList} from "./routes";

const doc = buildOpenApiDocument();

describe("document shape", () => {
  it("is OpenAPI 3.1", () => {
    expect(doc.openapi).toBe("3.1.0");
  });

  it("has a title and a version", () => {
    expect(doc.info.title).toMatch(/cope market/i);
    expect(doc.info.version).toBeTruthy();
  });

  it("serves from the versioned base path", () => {
    expect(doc.servers?.[0]?.url).toBe("/api/v1");
  });

  it("survives a JSON round trip", () => {
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });
});

describe("operations", () => {
  it("includes every route exactly once", () => {
    const operations = Object.values(doc.paths).flatMap((item) => Object.keys(item));
    expect(operations).toHaveLength(routeList.length);
  });

  it("places each route at its path with a leading slash", () => {
    for (const route of routeList) {
      const item = doc.paths[`/${route.path}`];
      expect(item, route.operationId).toBeDefined();
      expect(item![route.method.toLowerCase()], route.operationId).toBeDefined();
    }
  });

  it("carries the operationId, which Swift generation names methods after", () => {
    for (const route of routeList) {
      const op = doc.paths[`/${route.path}`]![route.method.toLowerCase()]!;
      expect(op.operationId).toBe(route.operationId);
    }
  });

  it("declares path parameters as required", () => {
    const op = doc.paths["/theses/{thesisId}"]!.get!;
    const param = op.parameters?.find((p) => p.name === "thesisId");
    expect(param?.in).toBe("path");
    expect(param?.required).toBe(true);
  });

  it("declares query parameters as optional unless the schema requires them", () => {
    const op = doc.paths["/feed"]!.get!;
    const names = op.parameters?.map((p) => p.name) ?? [];
    expect(names).toContain("tab");
    expect(names).toContain("cursor");
  });
});

describe("security", () => {
  it("defines bearer auth once", () => {
    expect(doc.components.securitySchemes.bearerAuth.type).toBe("http");
    expect(doc.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
  });

  /// An authenticated route with no security block generates a client that never sends the token.
  it("marks every authenticated route as requiring the bearer token", () => {
    for (const route of routeList.filter((r) => r.auth === "required")) {
      const op = doc.paths[`/${route.path}`]![route.method.toLowerCase()]!;
      expect(op.security, route.operationId).toEqual([{bearerAuth: []}]);
    }
  });

  it("marks public routes as needing no security", () => {
    for (const route of routeList.filter((r) => r.auth === "none")) {
      const op = doc.paths[`/${route.path}`]![route.method.toLowerCase()]!;
      expect(op.security, route.operationId).toEqual([]);
    }
  });

  it("documents 401 only on authenticated routes", () => {
    for (const route of routeList) {
      const op = doc.paths[`/${route.path}`]![route.method.toLowerCase()]!;
      const has401 = "401" in op.responses;
      expect(has401, route.operationId).toBe(needsToken(route.auth));
    }
  });
});

describe("responses", () => {
  it("documents a 200 with a schema on every route", () => {
    for (const route of routeList) {
      const op = doc.paths[`/${route.path}`]![route.method.toLowerCase()]!;
      const ok = op.responses["200"];
      expect(ok?.content?.["application/json"]?.schema, route.operationId).toBeDefined();
    }
  });

  it("documents the error envelope on 400 and 500", () => {
    const op = doc.paths["/feed"]!.get!;
    for (const status of ["400", "500"]) {
      expect(op.responses[status]?.content?.["application/json"]?.schema).toBeDefined();
    }
  });
});

/// Swift generation handles named components far better than repeated inline objects, and JSON
/// Schema keywords that OpenAPI does not know about make some tools reject the document.
describe("component hoisting", () => {
  const serialised = JSON.stringify(doc);

  it("leaves no $defs anywhere", () => {
    expect(serialised).not.toContain("$defs");
  });

  it("leaves no $schema anywhere", () => {
    expect(serialised).not.toContain("$schema");
  });

  it("resolves every $ref to a defined component", () => {
    const refs = [...serialised.matchAll(/"\$ref":"([^"]+)"/g)].map((m) => m[1] as string);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith("#/components/schemas/"), ref).toBe(true);
      const name = ref.replace("#/components/schemas/", "");
      expect(doc.components.schemas[name], `unresolved ${ref}`).toBeDefined();
    }
  });

  it("names the shared entities as components", () => {
    expect(Object.keys(doc.components.schemas)).toEqual(
      expect.arrayContaining(["Thesis", "Profile", "TradeIntent", "ApiError"]),
    );
  });

  /// The error envelope appears on three responses of every route. Inlining it copies the same
  /// object nearly eighty times and bloats the document clients have to download and parse.
  it("references the error envelope rather than inlining it", () => {
    const op = doc.paths["/feed"]!.get!;
    for (const status of ["400", "500"]) {
      const schema = op.responses[status]!.content!["application/json"]!.schema as {$ref?: string};
      expect(schema.$ref, status).toBe("#/components/schemas/ApiError");
    }
  });

  it("stays small enough to be cheap to fetch", () => {
    expect(JSON.stringify(doc).length).toBeLessThan(80_000);
  });
});
