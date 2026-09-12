import {createPublicClient, getAddress, http} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import type {Hex} from "viem";
import {createApiClient} from "../lib/api-client/client";
import {arcChain} from "../lib/chain/client";
import {closePool, getPool} from "../lib/db/pool";
import {upsertUser} from "../lib/db/users";
import {loadEnv, requireEnv} from "../lib/env";
import {getSubgraphClient} from "../lib/subgraph/client";
import {traderTotals, windowedTotals, winRateOf} from "../lib/subgraph/traders";

/// Checks that the API's P&L figures are the subgraph's, and that the subgraph's are the chain's.
///
/// Three sources have to agree, and the useful failure is the middle one: the API can be wired
/// correctly to a subgraph that is itself wrong. So this reconciles the subgraph against contract
/// calls first, and only then checks that the API repeats it.
///
///   ALLOW_TEST_TOKENS=1 npm run verify:subgraph
loadEnv();

const PORT = process.env["VERIFY_PORT"] ?? "4401";
const base = `http://localhost:${PORT}/api/v1`;
const log = (...parts: unknown[]) => console.log(...parts);

const failures: string[] = [];
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = String(actual) === String(expected);
  log(`${ok ? "ok  " : "FAIL"}  ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
  if (!ok) failures.push(label);
}

/// This sends nothing, so it asks for an address rather than a key. VERIFY_WALLET_ADDRESS names
/// the trader to reconcile; PRIVATE_KEY is accepted too, so the same shell that runs the trade and
/// social verifications runs this one with no extra setup.
function walletUnderTest(): `0x${string}` {
  const address = process.env["VERIFY_WALLET_ADDRESS"];
  if (address) return getAddress(address);
  const key = process.env["PRIVATE_KEY"];
  if (key) return privateKeyToAccount(key as Hex).address;
  throw new Error(
    "Set VERIFY_WALLET_ADDRESS to the trader to reconcile, or PRIVATE_KEY to derive it.",
  );
}

const address = walletUnderTest();
const reader = createPublicClient({chain: arcChain(), transport: http()});
const vault = requireEnv("SYNTHETIC_VAULT_ADDRESS") as `0x${string}`;
const subgraph = getSubgraphClient();

log("subgraph    ->", subgraph.url);
log("wallet      ->", address);

// --- the subgraph against the chain ------------------------------------------------------------

interface HeadResponse {
  _meta: {block: {number: number}; hasIndexingErrors: boolean};
  positions: {tokenId: string; status: string; units: string; entryPrice: string}[];
}

const head = await subgraph.query<HeadResponse>(`
  {
    _meta { block { number } hasIndexingErrors }
    positions(where: {status: OPEN}, first: 1000) { tokenId status units entryPrice }
  }
`);

check("indexing errors", head._meta.hasIndexingErrors, false);
log("indexed to  -> block", head._meta.block.number);

// Every open position must still have an owner. A position the subgraph calls open that the chain
// has burned is the exact failure an unwired close handler produces, and it reports no error.
let ownedOnChain = 0;
for (const position of head.positions) {
  try {
    await reader.readContract({
      address: vault,
      abi: [
        {
          type: "function",
          name: "ownerOf",
          stateMutability: "view",
          inputs: [{name: "tokenId", type: "uint256"}],
          outputs: [{name: "", type: "address"}],
        },
      ] as const,
      functionName: "ownerOf",
      args: [BigInt(position.tokenId)],
    });
    ownedOnChain += 1;
  } catch {
    log(`      token ${position.tokenId} is OPEN in the subgraph and burned on chain`);
  }
}
check("open positions still minted", ownedOnChain, head.positions.length);

// Notional is the strongest available cross-check: it uses units and entry price from the subgraph
// and compares against a number the contract maintains independently.
const byFeed = new Map<string, bigint>();
interface FeedResponse {
  positions: {asset: {id: string}; isLong: boolean; units: string; entryPrice: string}[];
}
const open = await subgraph.query<FeedResponse>(`
  {
    positions(where: {status: OPEN}, first: 1000) {
      asset { id }
      isLong
      units
      entryPrice
    }
  }
`);
for (const position of open.positions) {
  const key = `${position.asset.id}:${position.isLong}`;
  const notional = (BigInt(position.units) * BigInt(position.entryPrice)) / 10n ** 18n;
  byFeed.set(key, (byFeed.get(key) ?? 0n) + notional);
}

for (const [key, notional] of byFeed) {
  const [feedId, isLong] = key.split(":");
  const onChain = await reader.readContract({
    address: vault,
    abi: [
      {
        type: "function",
        name: "openInterest",
        stateMutability: "view",
        inputs: [
          {name: "feedId", type: "bytes32"},
          {name: "isLong", type: "bool"},
        ],
        outputs: [{name: "", type: "uint256"}],
      },
    ] as const,
    functionName: "openInterest",
    args: [feedId as `0x${string}`, isLong === "true"],
  });
  check(`openInterest ${feedId!.slice(0, 10)} long=${isLong}`, notional, onChain);
}

// --- the API against the subgraph ---------------------------------------------------------------

const pool = getPool();
// The same identity the trade and social verifications use. One wallet, one user, enforced by the
// schema, so this reuses it rather than the constraint being loosened.
const PRIVY_ID = "did:privy:verification-runner";
await upsertUser(pool, {
  privyId: PRIVY_ID,
  xHandle: "verify_author",
  xName: "Verify Author",
  xAvatarUrl: null,
  walletAddress: address,
});

const api = createApiClient({baseUrl: base, getAccessToken: async () => `test:${PRIVY_ID}`});

const expected = (await traderTotals(subgraph, [address])).get(address.toLowerCase()) ?? null;
if (expected === null) throw new Error(`the subgraph has no Trader row for ${address}`);

log("subgraph    -> pnl", expected.realizedPnlWad, "closed", expected.closedPositions);

const {profile} = await api.getMe({});
check("profile realizedPnlUsd", profile.stats.realizedPnlUsd, expected.realizedPnlWad);
check("profile closedPositions", profile.stats.closedPositions, expected.closedPositions);
check("profile openPositions", profile.stats.openPositions, expected.openPositions);

const lifetimeWindow =
  (await windowedTotals(subgraph, [address], 0)).get(address.toLowerCase()) ?? null;
if (lifetimeWindow === null) throw new Error("no closed positions to rank on");

// The two paths compute the same thing differently: one reads Trader's running totals, the other
// sums Position rows. They are only allowed to disagree if one of them is wrong.
check("windowed vs lifetime pnl", lifetimeWindow.realizedPnlWad, expected.realizedPnlWad);
check("windowed vs lifetime closes", lifetimeWindow.closedPositions, expected.closedPositions);

const {entries} = await api.getLeaderboard({query: {window: "all"}});
const mine = entries.find(
  (entry) => entry.user.walletAddress.toLowerCase() === address.toLowerCase(),
);
if (!mine) throw new Error("the runner is not on the leaderboard");

log(
  "leaderboard ->",
  entries
    .slice(0, 3)
    .map((e) => `${e.rank}. ${e.user.handle} pnl=${e.realizedPnlUsd}`)
    .join("  "),
);

check("leaderboard realizedPnlUsd", mine.realizedPnlUsd, expected.realizedPnlWad);
check("leaderboard closedPositions", mine.closedPositions, expected.closedPositions);
check("leaderboard winRate", mine.winRate, winRateOf(lifetimeWindow.wins, lifetimeWindow.losses));

// Ranking is the board's whole claim. An unordered list of correct numbers is still a wrong board.
let ordered = true;
for (let i = 1; i < entries.length; i++) {
  if (BigInt(entries[i - 1]!.realizedPnlUsd) < BigInt(entries[i]!.realizedPnlUsd)) ordered = false;
}
check("leaderboard is ordered by P&L", ordered, true);

await closePool();

if (failures.length > 0) {
  console.error(`\nFAILED: ${failures.join(", ")}`);
  process.exit(1);
}
log("\nVERIFIED: the chain, the subgraph and the API agree on P&L, positions and ranking");
