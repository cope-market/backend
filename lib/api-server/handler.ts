import type {ZodObject, ZodType, z} from "zod";
import type {RouteDefinition} from "../api-schema/route";
import type {ErrorCode} from "../api-schema/primitives";
import {AuthError, bearerToken, privyAppId, verifyPrivyToken} from "../auth/privy";
import type {PrivyClaims} from "../auth/privy";
import {findUserByPrivyId} from "../db/users";
import type {User} from "../db/users";
import {getPool} from "../db/pool";

/// Turns a route definition into a running handler. This is the fourth consumer of the registry,
/// after the OpenAPI document, the typed client and the mock: the same schemas that describe the
/// API are what validate a request reaching it.

const STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  PRICE_STALE: 400,
  PRICE_UNAVAILABLE: 400,
  ASSET_DISABLED: 400,
  CONFIDENCE_TOO_WIDE: 400,
  POSITION_CAP_EXCEEDED: 400,
  OPEN_INTEREST_CAP_EXCEEDED: 400,
  INSUFFICIENT_LIQUIDITY: 409,
  INSUFFICIENT_BALANCE: 400,
  QUOTE_EXPIRED: 409,
  GEO_BLOCKED: 403,
};

/// Thrown by an implementation to return a specific error. Anything else thrown is a bug and
/// becomes a 500.
export class ApiException extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiException";
  }
}

type Infer<T, Fallback> = T extends ZodType ? z.infer<T> : Fallback;

export interface HandlerContext<R extends RouteDefinition> {
  params: Infer<R["params"], Record<string, never>>;
  query: Infer<R["query"], Record<string, never>>;
  body: Infer<R["body"], Record<string, never>>;
  /// Non-null on routes declaring `auth: "required"`. Null only on a public route with no
  /// recognisable token.
  user: R["auth"] extends "required" ? User : User | null;
  request: Request;
}

export interface HandlerDeps {
  verifyToken?: (token: string) => Promise<PrivyClaims>;
  loadUser?: (privyId: string) => Promise<User | null>;
}

function errorResponse(code: ErrorCode, message: string): Response {
  return Response.json({error: {code, message}}, {status: STATUS[code]});
}

/// Turns a zod error into one readable sentence naming the fields that failed. The raw error is
/// hundreds of characters of nested JSON, and these messages reach users.
function describeIssues(error: {issues: Array<{path: PropertyKey[]; message: string}>}): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => {
      const field = issue.path.join(".");
      return field ? `${field}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

async function readBody(request: Request, schema: ZodType): Promise<unknown> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiException("VALIDATION", "Request body is not valid JSON.");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiException("VALIDATION", `Invalid request body. ${describeIssues(parsed.error)}`);
  }
  return parsed.data;
}

function parseOrThrow(schema: ZodObject, value: unknown, what: string): unknown {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiException("VALIDATION", `Invalid ${what}. ${describeIssues(parsed.error)}`);
  }
  return parsed.data;
}

export function defineHandler<R extends RouteDefinition>(
  route: R,
  implementation: (context: HandlerContext<R>) => Promise<z.infer<R["response"]>>,
  deps: HandlerDeps = {},
) {
  const verifyToken =
    deps.verifyToken ?? ((token: string) => verifyPrivyToken(token, {appId: privyAppId()}));
  const loadUser = deps.loadUser ?? ((privyId: string) => findUserByPrivyId(getPool(), privyId));

  return async function handle(
    request: Request,
    context: {params: Promise<Record<string, string>>},
  ): Promise<Response> {
    try {
      const params = route.params
        ? parseOrThrow(route.params as ZodObject, await context.params, "path parameter")
        : {};

      const url = new URL(request.url);
      const query = route.query
        ? parseOrThrow(
            route.query as ZodObject,
            Object.fromEntries(url.searchParams.entries()),
            "query parameter",
          )
        : {};

      const body = route.body ? await readBody(request, route.body as ZodType) : {};

      const token = bearerToken(Object.fromEntries(request.headers.entries()));
      let user: User | null = null;

      if (token) {
        try {
          const claims = await verifyToken(token);
          user = await loadUser(claims.privyId);
        } catch (cause) {
          // A bad token on a public route is not an error: the caller is simply anonymous. On an
          // authenticated route the check below turns it into a 401.
          if (route.auth === "required") {
            const message =
              cause instanceof AuthError ? cause.message : "Access token is not valid.";
            return errorResponse("UNAUTHORIZED", message);
          }
        }
      }

      if (route.auth === "required" && !user) {
        return errorResponse(
          "UNAUTHORIZED",
          token
            ? "No account exists for this token. Create a session first."
            : `${route.operationId} requires a bearer token.`,
        );
      }

      const result = await implementation({
        params,
        query,
        body,
        user,
        request,
      } as HandlerContext<R>);

      // A handler returning the wrong shape is a server bug. Shipping it would break clients
      // silently, somewhere else, later.
      const validated = route.response.safeParse(result);
      if (!validated.success) {
        console.error(`${route.operationId} produced an invalid response`, validated.error);
        return errorResponse("INTERNAL", "The server produced an invalid response.");
      }

      return Response.json(validated.data, {status: 200});
    } catch (cause) {
      if (cause instanceof ApiException) return errorResponse(cause.code, cause.message);
      if (cause instanceof AuthError) return errorResponse("UNAUTHORIZED", cause.message);

      // The detail stays in the log. A stack trace or a database message in a response is an
      // information leak.
      console.error(`${route.operationId} failed`, cause);
      return errorResponse("INTERNAL", "Something went wrong.");
    }
  };
}
