import {z} from "zod";
import type {ZodObject, ZodType} from "zod";
import {ApiError} from "./primitives";
import {routeList} from "./routes";
import {needsToken} from "./route";
import type {RouteDefinition} from "./route";
import {pathPlaceholders} from "./route";

/// Folds the route registry into an OpenAPI 3.1 document.
///
/// zod 4 emits JSON Schema draft 2020-12, which is the dialect OpenAPI 3.1 uses, so no translation
/// layer is needed. Two things do need fixing up: zod puts shared schemas under `$defs`, where
/// OpenAPI wants `components/schemas`, and it stamps a `$schema` key that some OpenAPI tools reject.

type Json = Record<string, unknown>;

interface MediaType {
  schema: Json;
}

interface ResponseObject {
  description: string;
  content: Record<string, MediaType>;
}

interface Operation {
  operationId: string;
  summary: string;
  tags: string[];
  security: Array<Record<string, string[]>>;
  parameters?: Array<{name: string; in: "path" | "query"; required: boolean; schema: Json}>;
  requestBody?: Json;
  responses: Record<string, ResponseObject>;
}

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
    description: string;
    license: {name: string; identifier: string};
  };
  servers: Array<{url: string}>;
  paths: Record<string, Record<string, Operation>>;
  components: {
    schemas: Record<string, Json>;
    securitySchemes: {bearerAuth: {type: string; scheme: string; bearerFormat: string}};
  };
}

const collectedComponents: Record<string, Json> = {};

/// Converts one schema, moving anything zod hoisted into `$defs` over to the shared component map
/// and rewriting the references to match.
function toSchema(schema: ZodType, io: "input" | "output"): Json {
  const generated = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io,
    // A route may reference a schema that cannot round-trip cleanly; emit something usable rather
    // than failing the whole document.
    unrepresentable: "any",
  }) as Json;

  const defs = generated["$defs"] as Record<string, Json> | undefined;
  if (defs) {
    for (const [name, definition] of Object.entries(defs)) {
      collectedComponents[name] = rewriteRefs(definition);
    }
  }

  delete generated["$defs"];
  delete generated["$schema"];
  return rewriteRefs(generated);
}

function rewriteRefs<T>(node: T): T {
  if (Array.isArray(node)) return node.map(rewriteRefs) as unknown as T;
  if (node === null || typeof node !== "object") return node;

  const out: Json = {};
  for (const [key, value] of Object.entries(node as Json)) {
    if (key === "$schema") continue;
    if (key === "$ref" && typeof value === "string") {
      out[key] = value.replace("#/$defs/", "#/components/schemas/");
      continue;
    }
    out[key] = rewriteRefs(value);
  }
  return out as T;
}

/// Query and path parameters are described one field at a time, which is what OpenAPI expects.
function parametersFor(route: RouteDefinition): Operation["parameters"] {
  const parameters: NonNullable<Operation["parameters"]> = [];

  for (const name of pathPlaceholders(route.path)) {
    const shape = (route.params as ZodObject).shape as Record<string, ZodType>;
    parameters.push({name, in: "path", required: true, schema: toSchema(shape[name]!, "input")});
  }

  if (route.query) {
    const shape = (route.query as ZodObject).shape as Record<string, ZodType>;
    for (const [name, field] of Object.entries(shape)) {
      parameters.push({
        name,
        in: "query",
        required: !field.safeParse(undefined).success,
        schema: toSchema(field, "input"),
      });
    }
  }

  return parameters.length > 0 ? parameters : undefined;
}

function tagFor(path: string): string {
  const head = path.split("/")[0] ?? "misc";
  return head.replace(/[{}]/g, "");
}

export function buildOpenApiDocument(): OpenApiDocument {
  for (const key of Object.keys(collectedComponents)) delete collectedComponents[key];

  const paths: OpenApiDocument["paths"] = {};
  const errorSchema = toSchema(ApiError, "output");

  // Referenced, not inlined. Three error responses on each of 26 routes means nearly eighty copies
  // of the same object otherwise, which clients pay to download and parse.
  const errorResponse = (description: string) => ({
    description,
    content: {"application/json": {schema: {$ref: "#/components/schemas/ApiError"}}},
  });

  for (const route of routeList) {
    const responses: Operation["responses"] = {
      "200": {
        description: "Success.",
        content: {"application/json": {schema: toSchema(route.response, "output")}},
      },
      "400": errorResponse("The request failed validation, or a rule rejected it."),
      "500": errorResponse("Unexpected server error."),
    };
    if (needsToken(route.auth)) {
      responses["401"] = errorResponse("Missing or invalid access token.");
    }

    const operation: Operation = {
      operationId: route.operationId,
      summary: route.summary,
      tags: [tagFor(route.path)],
      security: needsToken(route.auth) ? [{bearerAuth: []}] : [],
      responses,
    };

    const parameters = parametersFor(route);
    if (parameters) operation.parameters = parameters;

    if (route.body) {
      operation.requestBody = {
        required: true,
        content: {"application/json": {schema: toSchema(route.body, "input")}},
      };
    }

    const pathKey = `/${route.path}`;
    paths[pathKey] ??= {};
    paths[pathKey][route.method.toLowerCase()] = operation;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Cope Market API",
      version: "1.0.0",
      description:
        "Social layer for Cope Market. Positions, prices, balances and risk parameters are read " +
        "directly from the contracts on Arc and are deliberately not mirrored here.",
      license: {name: "MIT", identifier: "MIT"},
    },
    servers: [{url: "/api/v1"}],
    paths,
    components: {
      schemas: {...collectedComponents, ApiError: errorSchema},
      securitySchemes: {bearerAuth: {type: "http", scheme: "bearer", bearerFormat: "JWT"}},
    },
  };
}
