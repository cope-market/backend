import type {z} from "zod";
import {buildPath} from "../api-schema/route";
import type {RouteDefinition} from "../api-schema/route";
import {ApiError} from "../api-schema/primitives";
import {routes} from "../api-schema/routes";
import type {ErrorCode} from "../api-schema/primitives";

/// A typed fetch wrapper over the route registry. Argument and return types are derived from the
/// same zod schemas the server validates against, so a client call that compiles is a call the
/// server understands.

export class ApiRequestError extends Error {
  constructor(
    readonly code: ErrorCode | "NETWORK" | "MALFORMED_RESPONSE",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/// Each part is present only when the route declares it. The tuple wrappers stop the conditional
/// distributing over the union: a naked `undefined` resolves to `never`, which collapses the whole
/// intersection into a parameter type no argument can satisfy.
type ParamsPart<R extends RouteDefinition> = [R["params"]] extends [undefined]
  ? {params?: never}
  : {params: z.infer<NonNullable<R["params"]>>};

type QueryPart<R extends RouteDefinition> = [R["query"]] extends [undefined]
  ? {query?: never}
  : {query: z.input<NonNullable<R["query"]>>};

type BodyPart<R extends RouteDefinition> = [R["body"]] extends [undefined]
  ? {body?: never}
  : {body: z.input<NonNullable<R["body"]>>};

export type RouteInput<R extends RouteDefinition> = ParamsPart<R> & QueryPart<R> & BodyPart<R>;
export type RouteOutput<R extends RouteDefinition> = z.infer<R["response"]>;

export type ApiClient = {
  [K in keyof typeof routes]: (
    input: RouteInput<(typeof routes)[K]>,
  ) => Promise<RouteOutput<(typeof routes)[K]>>;
};

export interface ApiClientOptions {
  baseUrl: string;
  /// Returns the current Privy access token, or null when nobody is signed in.
  getAccessToken?: () => Promise<string | null>;
  fetch?: typeof fetch;
}

function queryString(query: Record<string, unknown> | undefined): string {
  if (!query) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    // Absent means "use the server's default". Sending an empty value would say something else.
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

async function readError(response: Response): Promise<ApiRequestError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new ApiRequestError(
      "NETWORK",
      `Request failed with status ${response.status} and a non-JSON body.`,
      response.status,
    );
  }

  const parsed = ApiError.safeParse(body);
  if (!parsed.success) {
    return new ApiRequestError(
      "MALFORMED_RESPONSE",
      `Request failed with status ${response.status} and an unrecognised error body.`,
      response.status,
    );
  }
  return new ApiRequestError(parsed.data.error.code, parsed.data.error.message, response.status);
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  const base = options.baseUrl.replace(/\/$/, "");

  const call = async (route: RouteDefinition, input: Record<string, unknown>) => {
    const headers: Record<string, string> = {};

    // The token is sent whenever one is available, not only on routes that demand it. A route's
    // auth mode says whether the SERVER requires a caller to be signed in, not whether the client
    // should identify itself: public routes personalise their responses when they can, and without
    // the token the feed's following tab is empty and every thesis reports viewerHasLiked as null.
    // This is our own API on our own origin, so offering the credential is not leaking it.
    const token = (await options.getAccessToken?.()) ?? null;
    if (token) headers["authorization"] = `Bearer ${token}`;

    if (route.auth === "required" && !token) {
      throw new ApiRequestError(
        "UNAUTHORIZED",
        `${route.operationId} needs authentication and no access token is available.`,
        401,
      );
    }

    const path = buildPath(route, (input["params"] as Record<string, string>) ?? {});
    const url = `${base}/${path}${queryString(input["query"] as Record<string, unknown>)}`;

    const init: RequestInit & {headers: Record<string, string>} = {method: route.method, headers};
    if (route.body) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(input["body"] ?? {});
    }

    const response = await doFetch(url, init);
    if (!response.ok) throw await readError(response);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiRequestError(
        "MALFORMED_RESPONSE",
        "Response body was not JSON.",
        response.status,
      );
    }

    // The server is trusted to be correct, not assumed to be. A shape mismatch is a server bug, and
    // passing it through turns it into a confusing failure somewhere else entirely.
    const parsed = route.response.safeParse(payload);
    if (!parsed.success) {
      throw new ApiRequestError(
        "MALFORMED_RESPONSE",
        `${route.operationId} returned a body that does not match its schema: ${parsed.error.message}`,
        response.status,
      );
    }
    return parsed.data;
  };

  const client = {} as Record<string, unknown>;
  for (const [name, route] of Object.entries(routes)) {
    client[name] = (input: Record<string, unknown> = {}) => call(route, input);
  }
  return client as ApiClient;
}
