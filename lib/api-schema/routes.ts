import {z} from "zod";
import {defineRoute} from "./route";
import type {RouteDefinition} from "./route";
import {ApiError, Cursor, FeedId, TxHash, XHandle, paginated} from "./primitives";
import {
  Asset,
  ChainConfig,
  Comment,
  Device,
  DevicePlatform,
  FeedTab,
  LeaderboardEntry,
  LeaderboardWindow,
  Notification,
  PaginationQuery,
  Profile,
  PublicProfile,
  Stance,
  Thesis,
  TradeIntent,
  Trade,
  TweetEmbed,
} from "./entities";
import {Amount6} from "./primitives";

/// Every endpoint, declared once. The OpenAPI document, the typed client and the mock server are
/// all folded from this object, so they cannot drift.
///
/// Routes deliberately absent: positions, prices, balances, liquidity-vault state and risk
/// parameters. The frontend reads those from the contracts with viem. See INTEGRATION.md.

export const routes = {
  // --- configuration ---------------------------------------------------------------------------

  getChains: defineRoute({
    method: "GET",
    path: "chains",
    operationId: "getChains",
    summary: "Chain and contract addresses for the current environment.",
    auth: "none",
    response: z.object({chains: z.array(ChainConfig)}),
  }),

  listAssets: defineRoute({
    method: "GET",
    path: "assets",
    operationId: "listAssets",
    summary: "Tradeable asset catalogue. Metadata only; prices come from the oracle contract.",
    auth: "none",
    response: z.object({assets: z.array(Asset)}),
  }),

  // --- authentication and profile --------------------------------------------------------------

  createSession: defineRoute({
    method: "POST",
    path: "auth/session",
    operationId: "createSession",
    summary: "Verify a Privy access token, create the user on first sight, return the profile.",
    // `token`, not `required`: this is what creates the account, so it cannot demand one already
    // exists. `required` here told a first-time caller to create a session using the endpoint that
    // creates sessions.
    auth: "token",
    body: z.object({}).describe("Empty. The token is the bearer credential."),
    response: z.object({profile: Profile}),
  }),

  getMe: defineRoute({
    method: "GET",
    path: "me",
    operationId: "getMe",
    summary: "The authenticated user's profile.",
    auth: "required",
    response: z.object({profile: Profile}),
  }),

  updateMe: defineRoute({
    method: "PATCH",
    path: "me",
    operationId: "updateMe",
    summary: "Update the authenticated user's bio.",
    auth: "required",
    body: z.object({bio: z.string().max(280).nullable()}),
    response: z.object({profile: Profile}),
  }),

  getUser: defineRoute({
    method: "GET",
    path: "users/{handle}",
    operationId: "getUser",
    summary: "A public profile by X handle.",
    auth: "none",
    params: z.object({handle: XHandle}),
    response: z.object({profile: PublicProfile}),
  }),

  followUser: defineRoute({
    method: "POST",
    path: "users/{handle}/follow",
    operationId: "followUser",
    summary: "Follow a user.",
    auth: "required",
    params: z.object({handle: XHandle}),
    body: z.object({}),
    response: z.object({isFollowing: z.boolean()}),
  }),

  unfollowUser: defineRoute({
    method: "DELETE",
    path: "users/{handle}/follow",
    operationId: "unfollowUser",
    summary: "Stop following a user.",
    auth: "required",
    params: z.object({handle: XHandle}),
    response: z.object({isFollowing: z.boolean()}),
  }),

  // --- events ------------------------------------------------------------------------------------

  resolveTweet: defineRoute({
    method: "POST",
    path: "events/oembed",
    operationId: "resolveTweet",
    summary: "Resolve a tweet URL to cached oEmbed HTML. X's endpoint has no CORS headers.",
    auth: "required",
    body: z.object({tweetUrl: z.url()}),
    response: z.object({event: TweetEmbed}),
  }),

  // --- theses --------------------------------------------------------------------------------------

  createThesis: defineRoute({
    method: "POST",
    path: "theses",
    operationId: "createThesis",
    summary: "Post a thesis. The backing position is attached later by confirming a trade.",
    auth: "required",
    body: z.object({
      feedId: FeedId,
      stance: Stance,
      title: z.string().min(1).max(120),
      body: z.string().max(2000),
      tweetUrl: z.url().nullable(),
      copiedFromThesisId: z.uuid().nullable(),
    }),
    response: z.object({thesis: Thesis}),
  }),

  getThesis: defineRoute({
    method: "GET",
    path: "theses/{thesisId}",
    operationId: "getThesis",
    summary: "Read one thesis.",
    auth: "none",
    params: z.object({thesisId: z.uuid()}),
    response: z.object({thesis: Thesis}),
  }),

  likeThesis: defineRoute({
    method: "POST",
    path: "theses/{thesisId}/like",
    operationId: "likeThesis",
    summary: "Like a thesis.",
    auth: "required",
    params: z.object({thesisId: z.uuid()}),
    body: z.object({}),
    response: z.object({likeCount: z.number().int(), viewerHasLiked: z.boolean()}),
  }),

  unlikeThesis: defineRoute({
    method: "DELETE",
    path: "theses/{thesisId}/like",
    operationId: "unlikeThesis",
    summary: "Remove a like.",
    auth: "required",
    params: z.object({thesisId: z.uuid()}),
    response: z.object({likeCount: z.number().int(), viewerHasLiked: z.boolean()}),
  }),

  listComments: defineRoute({
    method: "GET",
    path: "theses/{thesisId}/comments",
    operationId: "listComments",
    summary: "Comments on a thesis, newest first.",
    auth: "none",
    params: z.object({thesisId: z.uuid()}),
    query: PaginationQuery,
    response: paginated(Comment),
  }),

  createComment: defineRoute({
    method: "POST",
    path: "theses/{thesisId}/comments",
    operationId: "createComment",
    summary: "Comment on a thesis.",
    auth: "required",
    params: z.object({thesisId: z.uuid()}),
    body: z.object({body: z.string().min(1).max(1000)}),
    response: z.object({comment: Comment}),
  }),

  // --- feed and leaderboard --------------------------------------------------------------------

  getFeed: defineRoute({
    method: "GET",
    path: "feed",
    operationId: "getFeed",
    summary: "Ranked feed. Read each item's live P&L from the chain using its tokenId.",
    auth: "none",
    query: PaginationQuery.extend({tab: FeedTab.default("latest")}),
    response: paginated(Thesis),
  }),

  getLeaderboard: defineRoute({
    method: "GET",
    path: "leaderboard",
    operationId: "getLeaderboard",
    summary: "Traders ranked by realised P&L over a window.",
    auth: "none",
    query: z.object({window: LeaderboardWindow.default("7d")}),
    response: z.object({entries: z.array(LeaderboardEntry)}),
  }),

  // --- trading -----------------------------------------------------------------------------------

  createTradeIntent: defineRoute({
    method: "POST",
    path: "trades/intent",
    operationId: "createTradeIntent",
    summary: "Validate a trade and return an unsigned transaction to sign.",
    auth: "required",
    body: z.object({
      feedId: FeedId,
      isLong: z.boolean(),
      collateral: Amount6,
      thesisId: z.uuid().nullable(),
      copiedFromTokenId: z.string().nullable(),
    }),
    response: z.object({intent: TradeIntent}),
  }),

  createCloseIntent: defineRoute({
    method: "POST",
    path: "positions/{tokenId}/close-intent",
    operationId: "createCloseIntent",
    summary: "Return an unsigned transaction that closes a position.",
    auth: "required",
    params: z.object({tokenId: z.string()}),
    body: z.object({}),
    response: z.object({intent: TradeIntent}),
  }),

  confirmTrade: defineRoute({
    method: "POST",
    path: "trades/{tradeId}/confirm",
    operationId: "confirmTrade",
    summary: "Report the sent transaction. The server verifies the receipt on-chain.",
    auth: "required",
    params: z.object({tradeId: z.uuid()}),
    body: z.object({txHash: TxHash}),
    response: z.object({trade: Trade}),
  }),

  getTrade: defineRoute({
    method: "GET",
    path: "trades/{tradeId}",
    operationId: "getTrade",
    summary: "Poll a trade. Needed when a confirm call is interrupted.",
    auth: "required",
    params: z.object({tradeId: z.uuid()}),
    response: z.object({trade: Trade}),
  }),

  cancelTrade: defineRoute({
    method: "POST",
    path: "trades/{tradeId}/cancel",
    operationId: "cancelTrade",
    summary: "Abandon an intent that was never sent. Only valid while pending.",
    auth: "required",
    params: z.object({tradeId: z.uuid()}),
    body: z.object({}),
    response: z.object({trade: Trade}),
  }),

  // --- notifications and devices ----------------------------------------------------------------

  listNotifications: defineRoute({
    method: "GET",
    path: "notifications",
    operationId: "listNotifications",
    summary: "In-app inbox, newest first.",
    auth: "required",
    query: PaginationQuery,
    response: paginated(Notification),
  }),

  markNotificationsRead: defineRoute({
    method: "POST",
    path: "notifications/read",
    operationId: "markNotificationsRead",
    summary: "Mark notifications read. An empty list marks all of them.",
    auth: "required",
    body: z.object({ids: z.array(z.uuid())}),
    response: z.object({unreadCount: z.number().int()}),
  }),

  registerDevice: defineRoute({
    method: "POST",
    path: "devices",
    operationId: "registerDevice",
    summary: "Register a push token. Delivery itself is not implemented yet.",
    auth: "required",
    body: z.object({platform: DevicePlatform, token: z.string().min(1)}),
    response: z.object({device: Device}),
  }),

  deleteDevice: defineRoute({
    method: "DELETE",
    path: "devices/{deviceId}",
    operationId: "deleteDevice",
    summary: "Remove a push token.",
    auth: "required",
    params: z.object({deviceId: z.uuid()}),
    response: z.object({deleted: z.boolean()}),
  }),
} as const;

export type RouteName = keyof typeof routes;
export type Routes = typeof routes;

export const routeList: ReadonlyArray<RouteDefinition> = Object.values(routes);

/// Re-exported so consumers importing the registry also get the error shape every route can return.
export {ApiError, Cursor};
