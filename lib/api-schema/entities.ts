import {z} from "zod";
import {
  Address,
  Amount6,
  Bps,
  Cursor,
  FeedId,
  HexData,
  IsoDateTime,
  SignedWad,
  TxHash,
  Wad,
  XHandle,
} from "./primitives";

/// The object shapes the API returns. Anything the chain can answer directly is referenced by id
/// here rather than duplicated, so there is one source of truth for a number and it is the chain.

export const AssetClass = z.enum(["fx", "metal", "crypto", "equity"]);

export const Asset = z
  .object({
    feedId: FeedId,
    symbol: z.string().describe('Display symbol, for example "EUR/USD".'),
    name: z.string(),
    assetClass: AssetClass,
    logoUrl: z.url().nullable(),
  })
  .describe(
    "Catalogue metadata only. Risk parameters and prices come from the contracts; read " +
      "SyntheticVault.assetConfig and PushOracle.getPrice directly.",
  );

export const ChainConfig = z
  .object({
    chainId: z.number().int(),
    name: z.string(),
    rpcUrl: z.url(),
    explorerUrl: z.url(),
    nativeCurrency: z.object({
      name: z.string(),
      symbol: z.string(),
      decimals: z.number().int().describe("18 on Arc. The ERC-20 view of USDC uses 6."),
    }),
    minMaxFeePerGasWei: z.string().describe("Arc rejects a transaction below this. 20 gwei."),
    contracts: z.object({
      syntheticVault: Address,
      liquidityVault: Address,
      usdc: Address,
      oracle: Address,
    }),
    usdcDecimals: z.number().int().describe("6. The decimals every contract amount uses."),
  })
  .describe("Served so a client never hard-codes an address or a chain parameter.");

export const UserSummary = z.object({
  handle: XHandle,
  name: z.string(),
  avatarUrl: z.url().nullable(),
  walletAddress: Address,
});

export const UserStats = z.object({
  openPositions: z.number().int(),
  closedPositions: z.number().int(),
  realizedPnlUsd: SignedWad,
  followers: z.number().int(),
  following: z.number().int(),
  copiesReceived: z.number().int().describe("How many times this user's theses were copied."),
});

export const Profile = UserSummary.extend({
  bio: z.string().nullable(),
  createdAt: IsoDateTime,
  stats: UserStats,
});

export const ViewerRelation = z
  .object({
    isFollowing: z.boolean(),
    isSelf: z.boolean(),
  })
  .describe("Relative to the authenticated caller. Absent when the request is anonymous.");

export const PublicProfile = Profile.extend({
  viewer: ViewerRelation.nullable(),
});

export const TweetEmbed = z
  .object({
    tweetUrl: z.url(),
    authorHandle: z.string(),
    authorName: z.string(),
    html: z.string().describe("oEmbed HTML from X. Render in an isolated frame."),
    fetchedAt: IsoDateTime,
  })
  .describe("Cached server-side. X's oEmbed endpoint has no CORS headers.");

export const Stance = z.enum(["bullish", "bearish"]);

export const Thesis = z.object({
  id: z.uuid(),
  author: UserSummary,
  event: TweetEmbed.nullable(),
  feedId: FeedId,
  symbol: z.string(),
  stance: Stance,
  title: z.string(),
  body: z.string(),
  createdAt: IsoDateTime,
  likeCount: z.number().int(),
  commentCount: z.number().int(),
  copyCount: z.number().int(),
  tokenId: z
    .string()
    .nullable()
    .describe(
      "SyntheticVault position backing this thesis, or null if the trade has not confirmed. " +
        "Read live P&L from the contract with this id; the API does not mirror it.",
    ),
  copiedFromThesisId: z.uuid().nullable(),
  viewerHasLiked: z.boolean().nullable().describe("Null when the request is anonymous."),
});

export const Comment = z.object({
  id: z.uuid(),
  author: UserSummary,
  body: z.string(),
  createdAt: IsoDateTime,
});

export const LeaderboardEntry = z.object({
  rank: z.number().int().positive(),
  user: UserSummary,
  realizedPnlUsd: SignedWad,
  closedPositions: z.number().int(),
  winRate: z.number().min(0).max(1),
  copiesReceived: z.number().int(),
});

/// An unsigned transaction. The server builds it, the client signs and sends it, and the server
/// verifies the receipt afterwards. Client-reported amounts are never trusted.
export const TxRequest = z.object({
  chainId: z.number().int(),
  to: Address,
  data: HexData,
  value: z.string().describe('Wei, 18 decimals. "0" for every call this API builds today.'),
  maxFeePerGasWei: z.string().nullable().describe("Hint. Arc enforces a 20 gwei floor."),
});

export const Quote = z.object({
  feedId: FeedId,
  symbol: z.string(),
  isLong: z.boolean(),
  collateral: Amount6.describe("What the caller pays, before the open fee."),
  netCollateral: Amount6.describe("What the position records, after the open fee."),
  openFee: Amount6,
  openFeeBps: Bps,
  markPrice: Wad.describe("Oracle mid."),
  entryPrice: Wad.describe("Mid moved against the trader by the oracle confidence."),
  units: Wad.describe("Quantity of the synthetic asset, 18 decimals."),
});

export const TradeStatus = z.enum([
  "pending",
  "submitted",
  "confirmed",
  "failed",
  "cancelled",
  "expired",
]);

export const TradeAction = z.enum(["open", "close"]);

export const TradeIntent = z.object({
  tradeId: z.uuid(),
  action: TradeAction,
  status: TradeStatus,
  quote: Quote,
  tx: TxRequest,
  expiresAt: IsoDateTime.describe("Re-request after this. The quote is not honoured past it."),
});

export const Trade = z.object({
  tradeId: z.uuid(),
  action: TradeAction,
  status: TradeStatus,
  feedId: FeedId,
  txHash: TxHash.nullable(),
  tokenId: z.string().nullable(),
  thesisId: z.uuid().nullable(),
  error: z.string().nullable().describe("Set when status is failed."),
  createdAt: IsoDateTime,
  confirmedAt: IsoDateTime.nullable(),
});

export const NotificationKind = z.enum([
  "thesis_copied",
  "thesis_liked",
  "thesis_commented",
  "new_follower",
  "position_liquidated",
  "author_fee_earned",
]);

export const Notification = z.object({
  id: z.uuid(),
  kind: NotificationKind,
  payload: z.record(z.string(), z.unknown()),
  readAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});

export const DevicePlatform = z.enum(["web", "ios"]);

export const Device = z.object({
  id: z.uuid(),
  platform: DevicePlatform,
  createdAt: IsoDateTime,
});

export const FeedTab = z.enum(["latest", "top", "following"]);
export const LeaderboardWindow = z.enum(["7d", "30d", "all"]);

export const PaginationQuery = z.object({
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
