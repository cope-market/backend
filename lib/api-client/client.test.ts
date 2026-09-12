import {beforeEach, describe, expect, expectTypeOf, it, vi} from "vitest";
import {ApiRequestError, createApiClient} from "./client";

const profile = {
  handle: "alice",
  name: "Alice",
  avatarUrl: null,
  walletAddress: "0xeeb3e0999D01f0d1Ed465513E414725a357F6ae4",
  bio: null,
  createdAt: "2026-09-12T13:00:00.000Z",
  stats: {
    openPositions: 1,
    closedPositions: 2,
    realizedPnlUsd: "-450000000000000",
    followers: 3,
    following: 4,
    copiesReceived: 5,
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {"content-type": "application/json"},
  });
}

describe("request construction", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  const client = () =>
    createApiClient({
      baseUrl: "https://api.test/api/v1",
      fetch: fetchMock as unknown as typeof fetch,
      getAccessToken: async () => "tok_123",
    });

  it("issues the declared method against the declared path", async () => {
    fetchMock.mockResolvedValue(jsonResponse({assets: []}));
    await client().listAssets({});

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.test/api/v1/assets");
    expect(init.method).toBe("GET");
  });

  it("substitutes and encodes path parameters", async () => {
    fetchMock.mockResolvedValue(jsonResponse({profile: {...profile, viewer: null}}));
    await client().getUser({params: {handle: "alice"}});
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.test/api/v1/users/alice");
  });

  it("serialises query parameters and omits absent ones", async () => {
    fetchMock.mockResolvedValue(jsonResponse({data: [], nextCursor: null}));
    await client().getFeed({query: {tab: "top", limit: 5}});

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get("tab")).toBe("top");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.has("cursor")).toBe(false);
  });

  it("sends the body as JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse({likeCount: 1, viewerHasLiked: true}));
    await client().likeThesis({
      params: {thesisId: "6f1c9f40-0000-4000-8000-000000000000"},
      body: {},
    });

    const init = fetchMock.mock.calls[0]![1];
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.body).toBe("{}");
  });

  it("attaches the bearer token on authenticated routes", async () => {
    fetchMock.mockResolvedValue(jsonResponse({profile}));
    await client().getMe({});
    expect(fetchMock.mock.calls[0]![1].headers.authorization).toBe("Bearer tok_123");
  });

  /// Public routes personalise when they can: the feed's following tab and every viewerHasLiked
  /// flag depend on the server knowing who is asking. A route's auth mode says whether the server
  /// REQUIRES a caller to be signed in, not whether the client should identify itself.
  it("sends the token on public routes too, when one is available", async () => {
    fetchMock.mockResolvedValue(jsonResponse({assets: []}));
    await client().listAssets({});
    expect(fetchMock.mock.calls[0]![1].headers.authorization).toBe("Bearer tok_123");
  });

  it("sends no token on a public route when nobody is signed in", async () => {
    const anonymous = createApiClient({
      baseUrl: "https://api.test/api/v1",
      fetch: fetchMock as unknown as typeof fetch,
      getAccessToken: async () => null,
    });
    fetchMock.mockResolvedValue(jsonResponse({assets: []}));
    await anonymous.listAssets({});
    expect(fetchMock.mock.calls[0]![1].headers.authorization).toBeUndefined();
  });

  it("fails an authenticated call when no token is available", async () => {
    const anonymous = createApiClient({
      baseUrl: "https://api.test/api/v1",
      fetch: fetchMock as unknown as typeof fetch,
      getAccessToken: async () => null,
    });
    await expect(anonymous.getMe({})).rejects.toThrow(/authentication/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("response handling", () => {
  const fetchMock = vi.fn();
  const client = createApiClient({
    baseUrl: "https://api.test/api/v1",
    fetch: fetchMock as unknown as typeof fetch,
    getAccessToken: async () => "tok",
  });

  beforeEach(() => fetchMock.mockReset());

  it("returns the parsed body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({profile}));
    const result = await client.getMe({});
    expect(result.profile.handle).toBe("alice");
  });

  it("throws ApiRequestError carrying the server's code", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({error: {code: "PRICE_STALE", message: "market closed"}}, 400),
    );
    await expect(client.getMe({})).rejects.toMatchObject({
      code: "PRICE_STALE",
      status: 400,
    });
  });

  /// A server that returns the wrong shape is a bug, and a client that passes it through turns it
  /// into a confusing failure somewhere else entirely.
  it("throws when the response does not match the declared schema", async () => {
    fetchMock.mockResolvedValue(jsonResponse({profile: {handle: "alice"}}));
    await expect(client.getMe({})).rejects.toThrow(/schema/i);
  });

  it("throws a usable error when the body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>502</html>", {status: 502}));
    await expect(client.getMe({})).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe("types", () => {
  const client = createApiClient({baseUrl: "https://api.test/api/v1"});

  it("infers the response type from the registry", () => {
    expectTypeOf(client.getMe).returns.resolves.toHaveProperty("profile");
  });

  it("requires params where the path declares them", () => {
    expectTypeOf(client.getUser).parameter(0).toHaveProperty("params");
  });
});
