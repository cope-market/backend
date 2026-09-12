import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {createTestDatabase, type TestDatabase} from "../db/testing";
import {upsertUser} from "../db/users";
import {createThesis, likeThesis} from "./theses";
import {decodeFeedCursor, getFeed} from "./feed";
import {followUser, isFollowing, leaderboard, unfollowUser, userStats} from "./graph";
import {brokenSubgraph, stubSubgraph} from "../subgraph/testing";

let db: TestDatabase;
let alice: string;
let bob: string;
let carol: string;

const FEED = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

const ALICE_WALLET = "0x1111111111111111111111111111111111111111";
const BOB_WALLET = "0x2222222222222222222222222222222222222222";
const CAROL_WALLET = "0x3333333333333333333333333333333333333333";

/// A subgraph that has never heard of anybody. Most of these tests are about the follow graph, and
/// the on-chain half should contribute nothing to them.
const NO_TRADES = stubSubgraph({traders: {traders: []}, positions: {positions: []}});

const traderRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  positionsOpened: 0,
  positionsClosed: 0,
  realizedPnlWad: "0",
  wins: 0,
  losses: 0,
  copiesReceived: 0,
  authorFeesEarned: "0",
  ...overrides,
});

const makeUser = async (name: string, wallet: string) =>
  (
    await upsertUser(db.pool, {
      privyId: `did:privy:${name}`,
      xHandle: name,
      xName: name,
      xAvatarUrl: null,
      walletAddress: wallet,
    })
  ).id;

beforeAll(async () => {
  db = await createTestDatabase();
  alice = await makeUser("alice", "0x1111111111111111111111111111111111111111");
  bob = await makeUser("bob", "0x2222222222222222222222222222222222222222");
  carol = await makeUser("carol", "0x3333333333333333333333333333333333333333");
});
afterAll(() => db.drop());

const post = (userId: string, title: string) =>
  createThesis(db.pool, {
    userId,
    eventId: null,
    feedId: FEED,
    stance: "bullish",
    title,
    body: "",
    copiedFromThesisId: null,
  });

describe("follows", () => {
  it("follows and unfollows", async () => {
    expect(await followUser(db.pool, alice, bob)).toBe(true);
    expect(await isFollowing(db.pool, alice, bob)).toBe(true);
    await unfollowUser(db.pool, alice, bob);
    expect(await isFollowing(db.pool, alice, bob)).toBe(false);
  });

  it("is idempotent", async () => {
    await followUser(db.pool, alice, bob);
    await followUser(db.pool, alice, bob);
    expect((await userStats(db.pool, bob, BOB_WALLET, NO_TRADES)).followers).toBe(1);
  });

  /// Following yourself would inflate your own follower count and put your posts in your own feed.
  it("refuses to follow yourself", async () => {
    expect(await followUser(db.pool, alice, alice)).toBe(false);
    expect(await isFollowing(db.pool, alice, alice)).toBe(false);
  });
});

describe("userStats", () => {
  it("counts followers and following from the graph", async () => {
    await followUser(db.pool, carol, bob);
    const stats = await userStats(db.pool, bob, BOB_WALLET, NO_TRADES);
    expect(stats.followers).toBe(2);
    expect(stats.following).toBe(0);
  });

  it("counts copies received across a user's theses", async () => {
    const original = await post(bob, "original");
    await createThesis(db.pool, {
      userId: carol,
      eventId: null,
      feedId: FEED,
      stance: "bullish",
      title: "copy",
      body: "",
      copiedFromThesisId: original.id,
    });
    expect((await userStats(db.pool, bob, BOB_WALLET, NO_TRADES)).copiesReceived).toBe(1);
  });

  /// An address the subgraph has never seen has no row at all, which means it has never traded.
  it("reports zeros for a user who has never traded", async () => {
    const stats = await userStats(db.pool, bob, BOB_WALLET, NO_TRADES);
    expect(stats.realizedPnlUsd).toBe("0");
    expect(stats.openPositions).toBe(0);
    expect(stats.closedPositions).toBe(0);
  });

  it("reads realised P&L and position counts from the subgraph", async () => {
    const subgraph = stubSubgraph({
      traders: {
        traders: [
          traderRow(BOB_WALLET, {
            positionsOpened: 7,
            positionsClosed: 4,
            realizedPnlWad: "412500000000000000000",
          }),
        ],
      },
    });
    const stats = await userStats(db.pool, bob, BOB_WALLET, subgraph);

    expect(stats.realizedPnlUsd).toBe("412500000000000000000");
    expect(stats.openPositions).toBe(3);
    expect(stats.closedPositions).toBe(4);
  });

  /// A profile is worth showing without its P&L figure. It is not worth a 500, so the follow counts
  /// still come back and the P&L reads zero. The leaderboard makes the opposite choice.
  it("still renders the social half when the subgraph is down", async () => {
    const stats = await userStats(db.pool, bob, BOB_WALLET, brokenSubgraph());

    expect(stats.followers).toBe(2);
    expect(stats.realizedPnlUsd).toBe("0");
  });
});

/// Fresh users and an isolated follow graph. Sharing them with the tests above made assertions
/// depend on what had run before, which is a slow way to discover a query was fine all along.
describe("feed", () => {
  let dave: string;
  let erin: string;

  beforeAll(async () => {
    dave = await makeUser("dave", "0x4444444444444444444444444444444444444444");
    erin = await makeUser("erin", "0x5555555555555555555555555555555555555555");
    await followUser(db.pool, erin, dave);
  });

  it("returns newest first on the latest tab", async () => {
    await post(alice, "older");
    const newer = await post(alice, "newer");
    const {theses} = await getFeed(db.pool, {
      tab: "latest",
      viewerId: null,
      limit: 10,
      cursor: null,
    });
    expect(theses[0]?.id).toBe(newer.id);
  });

  /// Copies weigh most because somebody put money behind the take; likes weigh least.
  it("ranks an engaged thesis above a quiet one posted later", async () => {
    const popular = await post(dave, "popular");
    const quiet = await post(dave, "quiet");
    await likeThesis(db.pool, popular.id, alice);
    await likeThesis(db.pool, popular.id, bob);
    await likeThesis(db.pool, popular.id, carol);

    const {theses} = await getFeed(db.pool, {tab: "top", viewerId: null, limit: 50, cursor: null});
    const ids = theses.map((t) => t.id);
    expect(ids.indexOf(popular.id)).toBeLessThan(ids.indexOf(quiet.id));
  });

  it("shows only followed authors on the following tab", async () => {
    const {theses} = await getFeed(db.pool, {
      tab: "following",
      viewerId: erin,
      limit: 50,
      cursor: null,
    });
    expect(theses.length).toBeGreaterThan(0);
    expect(theses.every((t) => t.author.handle === "dave")).toBe(true);
  });

  it("returns nothing on the following tab for an anonymous reader", async () => {
    const {theses} = await getFeed(db.pool, {
      tab: "following",
      viewerId: null,
      limit: 10,
      cursor: null,
    });
    expect(theses).toEqual([]);
  });

  it("pages without repeating a thesis", async () => {
    const first = await getFeed(db.pool, {tab: "latest", viewerId: null, limit: 2, cursor: null});
    expect(first.nextCursor).not.toBeNull();

    const second = await getFeed(db.pool, {
      tab: "latest",
      viewerId: null,
      limit: 2,
      cursor: first.nextCursor,
    });
    const ids = [...first.theses, ...second.theses].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /// The reference time is pinned on the first page, so scores do not shift underneath a reader and
  /// make them see a row twice.
  it("carries the ranking reference time in the cursor", async () => {
    const {nextCursor} = await getFeed(db.pool, {
      tab: "top",
      viewerId: null,
      limit: 1,
      cursor: null,
    });
    expect(decodeFeedCursor(nextCursor!).at).toBeTruthy();
  });

  it("rejects a malformed cursor", () => {
    expect(() => decodeFeedCursor("bm90LWpzb24")).toThrow(/malformed/i);
  });
});

describe("leaderboard", () => {
  const WAD = 10n ** 18n;

  const closed = (id: string, author: string, pnl: bigint) => ({
    id,
    author: {id: author},
    realizedPnlWad: pnl.toString(),
  });

  /// The board's whole purpose. Whoever made the most money is first, whatever their follower count
  /// or posting rate says.
  it("ranks by realised P&L", async () => {
    const subgraph = stubSubgraph({
      positions: {
        positions: [
          closed("0x01", CAROL_WALLET, 5n * WAD),
          closed("0x02", BOB_WALLET, 9n * WAD),
          closed("0x03", ALICE_WALLET, -2n * WAD),
        ],
      },
    });
    const entries = await leaderboard(db.pool, "all", 25, subgraph);

    // Other users exist in this database and have traded nothing, so they tie at zero between the
    // winners and the loser. Only the relative order of the three that traded is asserted.
    const order = entries.map((e) => e.walletAddress.toLowerCase());
    expect(order.indexOf(BOB_WALLET)).toBeLessThan(order.indexOf(CAROL_WALLET));
    expect(order.indexOf(CAROL_WALLET)).toBeLessThan(order.indexOf(ALICE_WALLET));
    expect(entries[0]!.realizedPnlUsd).toBe((9n * WAD).toString());
  });

  /// A loss must rank below a trader who has done nothing, or the board rewards activity over
  /// results.
  it("puts a loss below someone who has never traded", async () => {
    const subgraph = stubSubgraph({
      positions: {positions: [closed("0x01", ALICE_WALLET, -2n * WAD)]},
    });
    const entries = await leaderboard(db.pool, "all", 25, subgraph);

    expect(entries[entries.length - 1]!.walletAddress.toLowerCase()).toBe(ALICE_WALLET);
  });

  /// These are 1e18 figures, so a five-figure result is past 2^53. Sorted as numbers, the top of
  /// the board would be ordered by rounding error.
  it("orders figures larger than a JavaScript number can distinguish", async () => {
    const big = 9_007_199_254_740_993n * WAD;
    const bigger = big + WAD;
    const subgraph = stubSubgraph({
      positions: {
        positions: [closed("0x01", ALICE_WALLET, big), closed("0x02", BOB_WALLET, bigger)],
      },
    });
    const entries = await leaderboard(db.pool, "all", 25, subgraph);

    expect(entries[0]!.realizedPnlUsd).toBe(bigger.toString());
    expect(entries[1]!.realizedPnlUsd).toBe(big.toString());
  });

  it("reports a real win rate", async () => {
    const subgraph = stubSubgraph({
      positions: {
        positions: [
          closed("0x01", BOB_WALLET, 3n * WAD),
          closed("0x02", BOB_WALLET, 1n * WAD),
          closed("0x03", BOB_WALLET, -1n * WAD),
          closed("0x04", BOB_WALLET, 0n),
        ],
      },
    });
    const [first] = await leaderboard(db.pool, "all", 25, subgraph);

    expect(first!.closedPositions).toBe(4);
    // Two wins out of four. The flat close counts against, not for.
    expect(first!.winRate).toBe(0.5);
  });

  it("reports zeros for a user the subgraph has never seen", async () => {
    const subgraph = stubSubgraph({positions: {positions: []}});
    const entries = await leaderboard(db.pool, "all", 25, subgraph);

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.realizedPnlUsd).toBe("0");
      expect(entry.winRate).toBe(0);
      expect(entry.closedPositions).toBe(0);
    }
  });

  /// Everyone who has traded nothing ties at zero. Copies break the tie so the tail of the board is
  /// in some meaningful order rather than an arbitrary one.
  it("breaks a tie at zero on copies received", async () => {
    const subgraph = stubSubgraph({positions: {positions: []}});
    const entries = await leaderboard(db.pool, "all", 25, subgraph);

    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1]!.copiesReceived).toBeGreaterThanOrEqual(entries[i]!.copiesReceived);
    }
  });

  it("honours the limit", async () => {
    const subgraph = stubSubgraph({positions: {positions: []}});
    expect(await leaderboard(db.pool, "all", 1, subgraph)).toHaveLength(1);
  });

  it("accepts every window", async () => {
    const subgraph = stubSubgraph({positions: {positions: []}});
    for (const window of ["7d", "30d", "all"] as const) {
      expect(Array.isArray(await leaderboard(db.pool, window, 25, subgraph))).toBe(true);
    }
  });

  /// A windowed board must ask for a cutoff; `all` must not. Passing a cutoff for `all` would hide
  /// every position closed before it.
  it("sends a cutoff for a window and none for all time", async () => {
    const asked: unknown[] = [];
    const recording = {
      url: "https://stub.invalid",
      async query<T>(_document: string, variables: Record<string, unknown> = {}): Promise<T> {
        asked.push(variables.since);
        return {positions: []} as T;
      },
    };

    await leaderboard(db.pool, "all", 25, recording);
    await leaderboard(db.pool, "7d", 25, recording);

    expect(asked[0]).toBe("0");
    expect(Number(asked[1])).toBeGreaterThan(Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60);
  });

  /// The opposite choice from a profile, and deliberate. A ranking assembled from missing data is
  /// not a partial answer; it is a wrong order presented as a right one.
  it("fails rather than ranking on missing data", async () => {
    await expect(leaderboard(db.pool, "all", 25, brokenSubgraph())).rejects.toThrow(
      /connection refused/,
    );
  });
});
