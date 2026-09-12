import {createServer, type Server} from "node:http";
import type {AddressInfo} from "node:net";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {createApiClient} from "../lib/api-client/client";
import {BASE_PATH, handleRequest} from "../lib/mock/server";
import {routes} from "../lib/api-schema/routes";
import type {RouteName} from "../lib/api-schema/routes";

/// End-to-end over real HTTP: the typed client calls the mock server, and the response is parsed
/// against the schema the registry declares. Registry, OpenAPI, client and mock are all folded from
/// one definition, and this is what proves they actually agree.

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    const result = handleRequest(
      request.method ?? "GET",
      request.url ?? "/",
      request.headers as Record<string, string | undefined>,
    );
    response.writeHead(result.status, result.headers);
    response.end(result.body);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${BASE_PATH}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const UUID = "6f1c9f40-0000-4000-8000-000000000001";
const FEED = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const TX = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

/// A valid argument for every route. Anything missing here is a route this suite cannot exercise,
/// and the coverage test below fails rather than quietly skipping it.
const inputs: Record<RouteName, Record<string, unknown>> = {
  getChains: {},
  listAssets: {},
  createSession: {body: {}},
  getMe: {},
  updateMe: {body: {bio: "gm"}},
  getUser: {params: {handle: "alice_macro"}},
  followUser: {params: {handle: "alice_macro"}, body: {}},
  unfollowUser: {params: {handle: "alice_macro"}},
  resolveTweet: {body: {tweetUrl: "https://x.com/a/status/1"}},
  createThesis: {
    body: {
      feedId: FEED,
      stance: "bullish",
      title: "t",
      body: "b",
      tweetUrl: null,
      copiedFromThesisId: null,
    },
  },
  getThesis: {params: {thesisId: UUID}},
  likeThesis: {params: {thesisId: UUID}, body: {}},
  unlikeThesis: {params: {thesisId: UUID}},
  listComments: {params: {thesisId: UUID}, query: {limit: 20}},
  createComment: {params: {thesisId: UUID}, body: {body: "nice"}},
  getFeed: {query: {tab: "latest", limit: 20}},
  getLeaderboard: {query: {window: "7d"}},
  createTradeIntent: {
    body: {feedId: FEED, isLong: true, collateral: "2000000", thesisId: null, copiedFromTokenId: null},
  },
  createCloseIntent: {params: {tokenId: "1"}, body: {}},
  confirmTrade: {params: {tradeId: UUID}, body: {txHash: TX}},
  getTrade: {params: {tradeId: UUID}},
  cancelTrade: {params: {tradeId: UUID}, body: {}},
  listNotifications: {query: {limit: 20}},
  markNotificationsRead: {body: {ids: []}},
  registerDevice: {body: {platform: "web", token: "tok"}},
  deleteDevice: {params: {deviceId: UUID}},
};

describe("client against mock", () => {
  it("exercises every route in the registry", () => {
    expect(Object.keys(inputs).sort()).toEqual(Object.keys(routes).sort());
  });

  it.each(Object.keys(routes))("%s round-trips and parses", async (name) => {
    const client = createApiClient({baseUrl, getAccessToken: async () => "tok"});
    const call = client[name as RouteName] as (input: unknown) => Promise<unknown>;

    // The client parses the response against the registry schema and throws if it disagrees, so a
    // call that resolves is proof the three sides match.
    await expect(call(inputs[name as RouteName])).resolves.toBeDefined();
  });
});

describe("auth is enforced end to end", () => {
  it("rejects an authenticated route when the client has no token", async () => {
    const anonymous = createApiClient({baseUrl, getAccessToken: async () => null});
    await expect(anonymous.getMe({})).rejects.toMatchObject({code: "UNAUTHORIZED"});
  });

  it("allows a public route with no token", async () => {
    const anonymous = createApiClient({baseUrl, getAccessToken: async () => null});
    await expect(anonymous.listAssets({})).resolves.toBeDefined();
  });
});
