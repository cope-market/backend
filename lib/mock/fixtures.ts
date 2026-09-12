import type {RouteName} from "../api-schema/routes";

/// Fixtures for the mock server. Values are taken from the live Arc testnet deployment so a client
/// built against them meets no surprises when it switches to the real API: real feed ids, real
/// contract addresses, real decimal scales.

const FEED_EUR = "0xa995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b";
const FEED_BTC = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const FEED_XAU = "0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2";
const FEED_TSLA = "0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1";

const NOW = "2026-09-12T13:00:00.000Z";

const alice = {
  handle: "alice_macro",
  name: "Alice",
  avatarUrl: "https://pbs.twimg.com/profile_images/alice.jpg",
  walletAddress: "0xeeb3e0999D01f0d1Ed465513E414725a357F6ae4",
};

const bob = {
  handle: "bob_fx",
  name: "Bob",
  avatarUrl: null,
  walletAddress: "0x311F471eF24971B6728F8b628C82e5396d222Fa9",
};

const aliceProfile = {
  ...alice,
  bio: "Macro, mostly wrong, occasionally early.",
  createdAt: "2026-09-01T09:00:00.000Z",
  stats: {
    openPositions: 2,
    closedPositions: 11,
    realizedPnlUsd: "412500000000000000000",
    followers: 128,
    following: 64,
    copiesReceived: 19,
  },
};

const tweet = {
  tweetUrl: "https://x.com/federalreserve/status/1900000000000000000",
  authorHandle: "federalreserve",
  authorName: "Federal Reserve",
  html: '<blockquote class="twitter-tweet"><p>FOMC statement released.</p></blockquote>',
  fetchedAt: NOW,
};

const thesis = {
  id: "6f1c9f40-0000-4000-8000-000000000001",
  author: alice,
  event: tweet,
  feedId: FEED_BTC,
  symbol: "BTC/USD",
  stance: "bullish" as const,
  title: "Cuts are coming, BTC front-runs it",
  body: "Dot plot moved. Risk assets lead, and BTC leads risk assets.",
  createdAt: NOW,
  likeCount: 24,
  commentCount: 3,
  copyCount: 5,
  tokenId: "1",
  copiedFromThesisId: null,
  viewerHasLiked: false,
};

const secondThesis = {
  ...thesis,
  id: "6f1c9f40-0000-4000-8000-000000000002",
  author: bob,
  feedId: FEED_EUR,
  symbol: "EUR/USD",
  stance: "bearish" as const,
  title: "ECB is done, EUR fades",
  body: "Terminal rate priced. Carry unwinds from here.",
  likeCount: 7,
  commentCount: 1,
  copyCount: 0,
  tokenId: null,
  event: null,
  viewerHasLiked: false,
};

const comment = {
  id: "6f1c9f40-0000-4000-8000-00000000000a",
  author: bob,
  body: "Disagree on the timing but the direction is right.",
  createdAt: NOW,
};

const quote = {
  feedId: FEED_BTC,
  symbol: "BTC/USD",
  isLong: true,
  collateral: "2000000",
  netCollateral: "1998000",
  openFee: "2000",
  openFeeBps: 10,
  markPrice: "77337890000000000000000",
  entryPrice: "77355490580460000000000",
  units: "25828806526949",
};

const intent = {
  tradeId: "6f1c9f40-0000-4000-8000-0000000000f1",
  action: "open" as const,
  status: "pending" as const,
  quote,
  tx: {
    chainId: 5042002,
    to: "0x2c720283A8Bbb5CC5b13C0C4Bcf2300826286c47",
    data: "0x00",
    value: "0",
    maxFeePerGasWei: "20000000000",
  },
  expiresAt: "2026-09-12T13:00:30.000Z",
};

const trade = {
  tradeId: intent.tradeId,
  action: "open" as const,
  status: "confirmed" as const,
  feedId: FEED_BTC,
  txHash: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  tokenId: "1",
  thesisId: thesis.id,
  error: null,
  createdAt: NOW,
  confirmedAt: NOW,
};

const asset = (feedId: string, symbol: string, name: string, assetClass: string) => ({
  feedId,
  symbol,
  name,
  assetClass,
  logoUrl: null,
});

/// One fixture per route, keyed by operationId. A route with no fixture is a route the mock cannot
/// serve, and a test fails when one is missing.
export const fixtures: Record<RouteName, unknown> = {
  getChains: {
    chains: [
      {
        chainId: 5042002,
        name: "Arc Testnet",
        rpcUrl: "https://rpc.testnet.arc.io",
        explorerUrl: "https://testnet.arcscan.app",
        nativeCurrency: {name: "USD Coin", symbol: "USDC", decimals: 18},
        minMaxFeePerGasWei: "20000000000",
        contracts: {
          syntheticVault: "0x2c720283A8Bbb5CC5b13C0C4Bcf2300826286c47",
          liquidityVault: "0x0ffABC4e80125C5742D5ed04Cc1fD1b634Bc3C5d",
          usdc: "0x3600000000000000000000000000000000000000",
          oracle: "0x0f2d191fEC3bB2DEEd8cE3E326193fd9b5203277",
        },
        usdcDecimals: 6,
      },
    ],
  },

  listAssets: {
    assets: [
      asset(FEED_EUR, "EUR/USD", "Euro", "fx"),
      asset(FEED_XAU, "XAU/USD", "Gold", "metal"),
      asset(FEED_BTC, "BTC/USD", "Bitcoin", "crypto"),
      asset(FEED_TSLA, "TSLA/USD", "Tesla", "equity"),
    ],
  },

  createSession: {profile: aliceProfile},
  getMe: {profile: aliceProfile},
  updateMe: {profile: aliceProfile},
  getUser: {profile: {...aliceProfile, viewer: {isFollowing: false, isSelf: false}}},
  followUser: {isFollowing: true},
  unfollowUser: {isFollowing: false},

  resolveTweet: {event: tweet},

  createThesis: {thesis},
  getThesis: {thesis},
  likeThesis: {likeCount: 25, viewerHasLiked: true},
  unlikeThesis: {likeCount: 24, viewerHasLiked: false},
  listComments: {data: [comment], nextCursor: null},
  createComment: {comment},

  getFeed: {data: [thesis, secondThesis], nextCursor: null},
  getLeaderboard: {
    entries: [
      {
        rank: 1,
        user: alice,
        realizedPnlUsd: "412500000000000000000",
        closedPositions: 11,
        winRate: 0.64,
        copiesReceived: 19,
      },
      {
        rank: 2,
        user: bob,
        realizedPnlUsd: "-88000000000000000000",
        closedPositions: 4,
        winRate: 0.25,
        copiesReceived: 0,
      },
    ],
  },

  createTradeIntent: {intent},
  createCloseIntent: {intent: {...intent, action: "close" as const}},
  confirmTrade: {trade},
  getTrade: {trade},
  cancelTrade: {trade: {...trade, status: "cancelled" as const, confirmedAt: null}},

  listNotifications: {
    data: [
      {
        id: "6f1c9f40-0000-4000-8000-0000000000b1",
        kind: "thesis_copied",
        payload: {thesisId: thesis.id, by: bob.handle},
        readAt: null,
        createdAt: NOW,
      },
    ],
    nextCursor: null,
  },
  markNotificationsRead: {unreadCount: 0},

  registerDevice: {
    device: {id: "6f1c9f40-0000-4000-8000-0000000000d1", platform: "web", createdAt: NOW},
  },
  deleteDevice: {deleted: true},
};
