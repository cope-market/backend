import {describe, expect, it} from "vitest";
import {z} from "zod";
import {ApiException, defineHandler} from "./handler";
import {defineRoute} from "../api-schema/route";
import {AuthError} from "../auth/privy";
import type {User} from "../db/users";

const user: User = {
  id: "6f1c9f40-0000-4000-8000-000000000001",
  privyId: "did:privy:alice",
  xHandle: "alice_macro",
  xName: "Alice",
  xAvatarUrl: null,
  walletAddress: "0xeeb3e0999D01f0d1Ed465513E414725a357F6ae4",
  bio: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
};

const deps = {
  verifyToken: async (token: string) => {
    if (token !== "good") throw new AuthError("Access token is not valid.");
    return {privyId: user.privyId, sessionId: null, expiresAt: new Date(Date.now() + 60_000)};
  },
  loadUser: async () => user,
};

const publicRoute = defineRoute({
  method: "GET",
  path: "widgets/{widgetId}",
  operationId: "getWidget",
  summary: "Read a widget for testing.",
  auth: "none",
  params: z.object({widgetId: z.uuid()}),
  query: z.object({limit: z.coerce.number().int().min(1).max(50).default(20)}),
  response: z.object({id: z.string(), limit: z.number(), signedIn: z.boolean()}),
});

const privateRoute = defineRoute({
  method: "POST",
  path: "widgets",
  operationId: "createWidget",
  summary: "Create a widget for testing.",
  auth: "required",
  body: z.object({name: z.string().min(1)}),
  response: z.object({handle: z.string()}),
});

const call = (
  handler: (
    request: Request,
    context: {params: Promise<Record<string, string>>},
  ) => Promise<Response>,
  url: string,
  init: RequestInit = {},
  params: Record<string, string> = {},
) => handler(new Request(url, init), {params: Promise.resolve(params)});

const ID = "6f1c9f40-0000-4000-8000-0000000000aa";

describe("validation", () => {
  const handler = defineHandler(
    publicRoute,
    async (ctx) => ({id: ctx.params.widgetId, limit: ctx.query.limit, signedIn: ctx.user !== null}),
    deps,
  );

  it("passes validated params and query to the implementation", async () => {
    const response = await call(
      handler,
      `http://t/api/v1/widgets/${ID}?limit=5`,
      {},
      {widgetId: ID},
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({id: ID, limit: 5, signedIn: false});
  });

  /// Defaults live in the schema, so a client that omits a parameter gets the documented behaviour
  /// rather than undefined.
  it("applies schema defaults for absent query parameters", async () => {
    const response = await call(handler, `http://t/api/v1/widgets/${ID}`, {}, {widgetId: ID});
    expect((await response.json()).limit).toBe(20);
  });

  it("rejects a malformed path parameter with 400 VALIDATION", async () => {
    const response = await call(handler, "http://t/api/v1/widgets/nope", {}, {widgetId: "nope"});
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION");
  });

  it("rejects an out-of-range query parameter", async () => {
    const response = await call(
      handler,
      `http://t/api/v1/widgets/${ID}?limit=500`,
      {},
      {widgetId: ID},
    );
    expect(response.status).toBe(400);
  });

  it("rejects a body that does not match the schema", async () => {
    const handler = defineHandler(privateRoute, async () => ({handle: "x"}), deps);
    const response = await call(handler, "http://t/api/v1/widgets", {
      method: "POST",
      headers: {authorization: "Bearer good", "content-type": "application/json"},
      body: JSON.stringify({name: ""}),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION");
  });

  it("rejects a body that is not JSON", async () => {
    const handler = defineHandler(privateRoute, async () => ({handle: "x"}), deps);
    const response = await call(handler, "http://t/api/v1/widgets", {
      method: "POST",
      headers: {authorization: "Bearer good", "content-type": "application/json"},
      body: "not json",
    });
    expect(response.status).toBe(400);
  });
});

describe("authentication", () => {
  const handler = defineHandler(privateRoute, async (ctx) => ({handle: ctx.user.xHandle}), deps);

  const post = (headers: Record<string, string>) =>
    call(handler, "http://t/api/v1/widgets", {
      method: "POST",
      headers: {"content-type": "application/json", ...headers},
      body: JSON.stringify({name: "w"}),
    });

  it("passes the signed-in user to the implementation", async () => {
    const response = await post({authorization: "Bearer good"});
    expect(await response.json()).toEqual({handle: "alice_macro"});
  });

  it("returns 401 when the route needs auth and no token is sent", async () => {
    const response = await post({});
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when the token does not verify", async () => {
    const response = await post({authorization: "Bearer bad"});
    expect(response.status).toBe(401);
  });

  /// A verified token for someone with no row here means sign-in never completed.
  it("returns 401 when the token is valid but the user is unknown", async () => {
    const handler = defineHandler(privateRoute, async (ctx) => ({handle: ctx.user.xHandle}), {
      ...deps,
      loadUser: async () => null,
    });
    const response = await call(handler, "http://t/api/v1/widgets", {
      method: "POST",
      headers: {authorization: "Bearer good", "content-type": "application/json"},
      body: JSON.stringify({name: "w"}),
    });
    expect(response.status).toBe(401);
  });

  /// A public route still identifies the caller when it can, so it can personalise a response.
  it("resolves the user on a public route when a token is present", async () => {
    const handler = defineHandler(
      publicRoute,
      async (ctx) => ({
        id: ctx.params.widgetId,
        limit: ctx.query.limit,
        signedIn: ctx.user !== null,
      }),
      deps,
    );
    const response = await call(
      handler,
      `http://t/api/v1/widgets/${ID}`,
      {headers: {authorization: "Bearer good"}},
      {widgetId: ID},
    );
    expect((await response.json()).signedIn).toBe(true);
  });

  it("treats an unreadable token on a public route as anonymous", async () => {
    const handler = defineHandler(
      publicRoute,
      async (ctx) => ({
        id: ctx.params.widgetId,
        limit: ctx.query.limit,
        signedIn: ctx.user !== null,
      }),
      deps,
    );
    const response = await call(
      handler,
      `http://t/api/v1/widgets/${ID}`,
      {headers: {authorization: "Bearer bad"}},
      {widgetId: ID},
    );
    expect(response.status).toBe(200);
    expect((await response.json()).signedIn).toBe(false);
  });
});

describe("errors", () => {
  it("maps ApiException onto its declared code and status", async () => {
    const handler = defineHandler(
      publicRoute,
      async () => {
        throw new ApiException("NOT_FOUND", "No such widget.");
      },
      deps,
    );
    const response = await call(handler, `http://t/api/v1/widgets/${ID}`, {}, {widgetId: ID});
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({error: {code: "NOT_FOUND", message: "No such widget."}});
  });

  /// An unexpected error is a bug. The client gets a stable shape; the detail stays in the log,
  /// because a stack trace or a database message in a response is an information leak.
  it("maps an unexpected error to 500 without leaking its message", async () => {
    const handler = defineHandler(
      publicRoute,
      async () => {
        throw new Error("connection string postgres://user:hunter2@db/cope failed");
      },
      deps,
    );
    const response = await call(handler, `http://t/api/v1/widgets/${ID}`, {}, {widgetId: ID});
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });

  /// A handler returning the wrong shape is a server bug, and shipping it would break clients
  /// silently and somewhere else.
  it("returns 500 when the implementation returns a body that fails its own schema", async () => {
    const handler = defineHandler(
      publicRoute,
      async () => ({id: 1}) as unknown as {id: string; limit: number; signedIn: boolean},
      deps,
    );
    const response = await call(handler, `http://t/api/v1/widgets/${ID}`, {}, {widgetId: ID});
    expect(response.status).toBe(500);
  });
});
