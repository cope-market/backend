import type {ZodObject, ZodType} from "zod";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/// Whether a caller must present a Privy access token. Declared per route and never inferred from
/// the path, so adding a route under an authenticated prefix cannot silently make it public.
/// How a route authenticates.
///
/// `token` exists because account creation is a bootstrap problem. `required` means a verified
/// token AND an account row, which is what nearly every route wants — but the route that creates
/// the account cannot demand one, or a first-time user is told to create a session by the very
/// endpoint that creates sessions. `token` means the token must verify and the account may not
/// exist yet.
///
/// To a client and to the OpenAPI document, `token` and `required` are the same: a bearer token is
/// needed and a 401 is possible. The difference is only what the server checks.
export type AuthMode = "required" | "token" | "none";

/// True when the route needs a bearer token from the caller, whether or not an account exists.
export function needsToken(auth: AuthMode): boolean {
  return auth === "required" || auth === "token";
}

export interface RouteDefinition<
  TParams extends ZodObject | undefined = ZodObject | undefined,
  TQuery extends ZodObject | undefined = ZodObject | undefined,
  TBody extends ZodType | undefined = ZodType | undefined,
  TResponse extends ZodType = ZodType,
  TAuth extends AuthMode = AuthMode,
> {
  readonly method: HttpMethod;
  /// Path relative to /api/v1, with placeholders in braces: "theses/{thesisId}/comments".
  readonly path: string;
  /// Stable identifier. Swift code generation names its methods after this.
  readonly operationId: string;
  readonly summary: string;
  readonly auth: TAuth;
  readonly params?: TParams;
  readonly query?: TQuery;
  readonly body?: TBody;
  readonly response: TResponse;
}

const PLACEHOLDER = /\{([^}]+)\}/g;

/// Names of the placeholders in a path, in the order they appear.
export function pathPlaceholders(path: string): string[] {
  return [...path.matchAll(PLACEHOLDER)].map((match) => match[1] as string);
}

/// Declares one route. The checks here run at module load, so a malformed route fails the build and
/// the test suite rather than a request in production.
/// The generics default to `undefined` rather than to their constraint. Without that, omitting
/// `params` infers `ZodObject | undefined`, and a client derived from the route would demand a
/// params argument for a route that has none.
export function defineRoute<
  TResponse extends ZodType,
  TAuth extends AuthMode,
  TParams extends ZodObject | undefined = undefined,
  TQuery extends ZodObject | undefined = undefined,
  TBody extends ZodType | undefined = undefined,
>(
  definition: RouteDefinition<TParams, TQuery, TBody, TResponse, TAuth>,
): RouteDefinition<TParams, TQuery, TBody, TResponse, TAuth> {
  const {method, path, operationId, params, body} = definition;

  const placeholders = pathPlaceholders(path);
  const declared = params ? Object.keys(params.shape) : [];

  const missing = placeholders.filter((name) => !declared.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `Route ${operationId} declares placeholders [${missing.join(", ")}] in "${path}" ` +
        `with no matching params schema. An undeclared placeholder is never validated.`,
    );
  }

  const extra = declared.filter((name) => !placeholders.includes(name));
  if (extra.length > 0) {
    throw new Error(
      `Route ${operationId} has params [${extra.join(", ")}] that appear nowhere in "${path}".`,
    );
  }

  if (method === "GET" && body !== undefined) {
    throw new Error(`Route ${operationId} is a GET and cannot carry a body.`);
  }

  return definition;
}

/// Fills a route's placeholders. Values are percent-encoded, because a handle or a symbol can
/// contain characters that would otherwise change the shape of the URL.
export function buildPath(route: RouteDefinition, values: Record<string, string>): string {
  return route.path.replace(PLACEHOLDER, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`Missing path parameter "${name}" for route ${route.operationId}.`);
    }
    return encodeURIComponent(value);
  });
}
