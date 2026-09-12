import {fixtures} from "./fixtures";
import {routeList} from "../api-schema/routes";
import type {RouteDefinition} from "../api-schema/route";
import {pathPlaceholders} from "../api-schema/route";
import type {RouteName} from "../api-schema/routes";

/// A mock of the API that needs no database and no chain. It exists so the frontend can be built
/// and demonstrated before the real endpoints land, against exactly the shapes they will return.
///
/// It is deliberately dumb: every route answers with its fixture. It does not remember writes.

export const BASE_PATH = "/api/v1";

export interface MockResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
  "access-control-max-age": "86400",
};

function json(status: number, body: unknown): MockResponse {
  return {
    status,
    headers: {...CORS, "content-type": "application/json"},
    body: JSON.stringify(body, null, 2),
  };
}

function error(status: number, code: string, message: string): MockResponse {
  return json(status, {error: {code, message}});
}

/// Matches a concrete path against a route template, so "users/alice" matches "users/{handle}".
function matches(route: RouteDefinition, method: string, segments: string[]): boolean {
  if (route.method !== method) return false;
  const template = route.path.split("/");
  if (template.length !== segments.length) return false;

  return template.every((part, index) => {
    if (part.startsWith("{") && part.endsWith("}")) return segments[index] !== "";
    return part === segments[index];
  });
}

export function findRoute(method: string, pathname: string): RouteDefinition | undefined {
  const relative = pathname.startsWith(BASE_PATH) ? pathname.slice(BASE_PATH.length) : pathname;
  const segments = relative.replace(/^\/+|\/+$/g, "").split("/");
  return routeList.find((route) => matches(route, method, segments));
}

export function handleRequest(
  method: string,
  url: string,
  headers: Record<string, string | undefined>,
): MockResponse {
  if (method === "OPTIONS") return {status: 204, headers: CORS, body: ""};

  const {pathname} = new URL(url, "http://mock.local");

  if (pathname === `${BASE_PATH}/openapi.json`) {
    return json(200, {note: "Run `npm run openapi:gen`; the document is served from public/."});
  }

  const route = findRoute(method, pathname);
  if (!route) {
    return error(404, "NOT_FOUND", `No route for ${method} ${pathname}.`);
  }

  // Auth is enforced so a client can exercise its signed-out paths. The token is not inspected;
  // any bearer value is accepted.
  if (route.auth === "required") {
    const authorization = headers["authorization"] ?? headers["Authorization"];
    if (!authorization?.startsWith("Bearer ")) {
      return error(401, "UNAUTHORIZED", `${route.operationId} requires a bearer token.`);
    }
  }

  return json(200, fixtures[route.operationId as RouteName]);
}

export function describeRoutes(): string {
  return routeList
    .map((route) => {
      const params = pathPlaceholders(route.path);
      const note = params.length > 0 ? `  (${params.join(", ")})` : "";
      const lock = route.auth === "required" ? " [auth]" : "";
      return `  ${route.method.padEnd(6)} ${BASE_PATH}/${route.path}${lock}${note}`;
    })
    .join("\n");
}
