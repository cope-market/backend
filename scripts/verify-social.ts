import {createWalletClient, createPublicClient, http, type Address, type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {arcChain} from "../lib/chain/client";
import type {ApiRequestError} from "../lib/api-client/client";
import {createApiClient} from "../lib/api-client/client";
import {getPool, closePool} from "../lib/db/pool";
import {upsertUser} from "../lib/db/users";
import {loadEnv, requireEnv} from "../lib/env";
import {assetCatalogue} from "../lib/config/assets";

/// The whole social loop against a real database and a real chain: an author posts a thesis and
/// backs it with a real position, a second person copies it, and both show up in the feed.
///
///   ALLOW_TEST_TOKENS=1 npm run verify:social
loadEnv();

const PORT = process.env["VERIFY_PORT"] ?? "4401";
const base = `http://localhost:${PORT}/api/v1`;
const log = (...parts: unknown[]) => console.log(...parts);

const account = privateKeyToAccount(requireEnv("PRIVATE_KEY") as Hex);
const wallet = createWalletClient({account, chain: arcChain(), transport: http()});
const reader = createPublicClient({chain: arcChain(), transport: http()});

const pool = getPool();
// One wallet, one user, enforced by the schema. The trade verification already claimed this
// address, so the author reuses that identity rather than the constraint being loosened.
const AUTHOR_PRIVY_ID = "did:privy:verification-runner";
const author = await upsertUser(pool, {
  privyId: AUTHOR_PRIVY_ID,
  xHandle: "verify_author",
  xName: "Verify Author",
  xAvatarUrl: null,
  walletAddress: account.address,
});
const copier = await upsertUser(pool, {
  privyId: "did:privy:verify-copier",
  xHandle: "verify_copier",
  xName: "Verify Copier",
  xAvatarUrl: null,
  walletAddress: "0x000000000000000000000000000000000000c0de",
});
void author;
void copier;

const asAuthor = createApiClient({
  baseUrl: base,
  getAccessToken: async () => `test:${AUTHOR_PRIVY_ID}`,
});
const asCopier = createApiClient({
  baseUrl: base,
  getAccessToken: async () => "test:did:privy:verify-copier",
});

const btc = assetCatalogue().find((asset) => asset.symbol === "BTC/USD")!;

// X's oEmbed is a third-party dependency. If it is unreachable the rest of the loop still means
// something, so this reports rather than aborts.
let tweetUrl: string | null = "https://x.com/jack/status/20";
try {
  const {event} = await asAuthor.resolveTweet({body: {tweetUrl}});
  log("oembed      ->", event.authorName, `(${event.html.length} bytes of html)`);
} catch (error) {
  log("oembed      -> unavailable:", (error as ApiRequestError).message);
  tweetUrl = null;
}

const {thesis} = await asAuthor.createThesis({
  body: {
    feedId: btc.feedId,
    stance: "bullish",
    title: "Cuts are coming, BTC front-runs it",
    body: "Dot plot moved. Risk assets lead.",
    tweetUrl,
    copiedFromThesisId: null,
  },
});
log("thesis      ->", thesis.id, `"${thesis.title}"`, "tokenId", thesis.tokenId);

const {intent} = await asAuthor.createTradeIntent({
  body: {
    feedId: btc.feedId,
    isLong: true,
    collateral: "2000000",
    thesisId: thesis.id,
    copiedFromTokenId: null,
  },
});
const hash = await wallet.sendTransaction({
  to: intent.tx.to as Address,
  data: intent.tx.data as Hex,
  value: 0n,
});
await reader.waitForTransactionReceipt({hash});
const {trade} = await asAuthor.confirmTrade({
  params: {tradeId: intent.tradeId},
  body: {txHash: hash},
});
log("trade       ->", trade.status, "tokenId", trade.tokenId);

const {thesis: backed} = await asAuthor.getThesis({params: {thesisId: thesis.id}});
log(
  "thesis now  -> tokenId",
  backed.tokenId,
  backed.tokenId === trade.tokenId ? "(linked)" : "(NOT LINKED)",
);
if (backed.tokenId !== trade.tokenId) throw new Error("thesis did not link to its position");

const {thesis: copy} = await asCopier.createThesis({
  body: {
    feedId: btc.feedId,
    stance: "bullish",
    title: "Copying this",
    body: "",
    tweetUrl: null,
    copiedFromThesisId: thesis.id,
  },
});
log("copy        ->", copy.id, "copiedFrom", copy.copiedFromThesisId);

await asCopier.likeThesis({params: {thesisId: thesis.id}, body: {}});
await asCopier.createComment({params: {thesisId: thesis.id}, body: {body: "Disagree on timing"}});
await asCopier.followUser({params: {handle: "verify_author"}, body: {}});

const {thesis: engaged} = await asCopier.getThesis({params: {thesisId: thesis.id}});
log(
  "engagement  -> likes",
  engaged.likeCount,
  "comments",
  engaged.commentCount,
  "copies",
  engaged.copyCount,
  "viewerHasLiked",
  engaged.viewerHasLiked,
);
if (engaged.copyCount < 1 || engaged.likeCount < 1) throw new Error("counters did not move");

const latest = await asCopier.getFeed({query: {tab: "latest", limit: 10}});
const top = await asCopier.getFeed({query: {tab: "top", limit: 10}});
const following = await asCopier.getFeed({query: {tab: "following", limit: 10}});
log("feed latest ->", latest.data.length, "items");
log("feed top    ->", top.data.length, "items, first:", top.data[0]?.title);
log(
  "feed follow ->",
  following.data.length,
  "items, all by author:",
  following.data.every((t) => t.author.handle === "verify_author"),
);
if (following.data.length === 0) throw new Error("following feed was empty after following");

const {profile} = await asCopier.getUser({params: {handle: "verify_author"}});
log(
  "profile     -> followers",
  profile.stats.followers,
  "copiesReceived",
  profile.stats.copiesReceived,
  "openPositions",
  profile.stats.openPositions,
  "viewerFollows",
  profile.viewer?.isFollowing,
);

const {entries} = await asCopier.getLeaderboard({query: {window: "all"}});
log(
  "leaderboard ->",
  entries
    .slice(0, 3)
    .map((e) => `${e.rank}. ${e.user.handle} copies=${e.copiesReceived}`)
    .join("  "),
);

log("VERIFIED: thesis, real position, copy, engagement, feeds, profile and leaderboard");
await closePool();
