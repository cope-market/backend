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

const BOB_WALLET = "0x2222222222222222222222222222222222222222";

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
  it("ranks by copies received", async () => {
    const entries = await leaderboard(db.pool, "all");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.copiesReceived).toBeGreaterThanOrEqual(entries[1]?.copiesReceived ?? 0);
  });

  /// Sorting on a column that is zero for everybody would present an arbitrary order as a ranking.
  it("reports P&L and win rate as zero rather than guessing them", async () => {
    const [first] = await leaderboard(db.pool, "all");
    expect(first?.realizedPnlUsd).toBe("0");
    expect(first?.winRate).toBe(0);
  });

  it("accepts every window", async () => {
    for (const window of ["7d", "30d", "all"] as const) {
      expect(Array.isArray(await leaderboard(db.pool, window))).toBe(true);
    }
  });
});
