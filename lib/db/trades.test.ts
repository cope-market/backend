import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {createTestDatabase, type TestDatabase} from "./testing";
import {upsertUser} from "./users";
import {
  findTrade,
  insertTrade,
  markCancelled,
  markConfirmed,
  markFailed,
  markSubmitted,
} from "./trades";
import type {NewTrade} from "./trades";

let db: TestDatabase;
let userId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  const user = await upsertUser(db.pool, {
    privyId: "did:privy:alice",
    xHandle: "alice_macro",
    xName: "Alice",
    xAvatarUrl: null,
    walletAddress: "0xeeb3e0999D01f0d1Ed465513E414725a357F6ae4",
  });
  userId = user.id;
});
afterAll(() => db.drop());

const FEED = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const HASH = "0x" + "ab".repeat(32);

const intent = (over: Partial<NewTrade> = {}): NewTrade => ({
  userId,
  action: "open",
  feedId: FEED,
  isLong: true,
  collateral: 2_000_000n,
  tokenId: null,
  copiedFromTokenId: null,
  quote: {entryPrice: "77355490580460000000000"},
  tx: {to: "0x00", data: "0x00"},
  thesisId: null,
  expiresAt: new Date(Date.now() + 30_000),
  ...over,
});

describe("insertTrade", () => {
  it("records an intent as pending", async () => {
    const trade = await insertTrade(db.pool, intent());
    expect(trade.status).toBe("pending");
    expect(trade.txHash).toBeNull();
  });

  /// A uint256 does not fit in a JavaScript number or a Postgres bigint. Numeric columns read back
  /// as strings, and the round trip has to survive a value larger than 2^53.
  it("round-trips values larger than a double can hold", async () => {
    const huge = 2n ** 200n;
    const trade = await insertTrade(db.pool, intent({tokenId: huge, collateral: huge}));
    const read = await findTrade(db.pool, trade.id);
    expect(read?.tokenId).toBe(huge);
    expect(read?.collateral).toBe(huge);
  });

  it("keeps the quote and the transaction that were shown to the user", async () => {
    const trade = await insertTrade(db.pool, intent());
    const read = await findTrade(db.pool, trade.id);
    expect((read?.quote as {entryPrice: string}).entryPrice).toBe("77355490580460000000000");
  });
});

describe("status transitions", () => {
  it("moves pending to submitted with a transaction hash", async () => {
    const trade = await insertTrade(db.pool, intent());
    const submitted = await markSubmitted(db.pool, trade.id, HASH);
    expect(submitted?.status).toBe("submitted");
    expect(submitted?.txHash).toBe(HASH);
  });

  it("confirms with the token id read from the receipt", async () => {
    const trade = await insertTrade(db.pool, intent());
    await markSubmitted(db.pool, trade.id, "0x" + "cd".repeat(32));
    const confirmed = await markConfirmed(db.pool, trade.id, 42n);
    expect(confirmed?.status).toBe("confirmed");
    expect(confirmed?.tokenId).toBe(42n);
    expect(confirmed?.confirmedAt).not.toBeNull();
  });

  it("records why a trade failed", async () => {
    const trade = await insertTrade(db.pool, intent());
    const failed = await markFailed(db.pool, trade.id, "reverted: StalePrice");
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toContain("StalePrice");
  });
});

/// One transaction settles one trade. Without the constraint, a confirm replayed against a second
/// intent would record the same fill twice and double-count a position.
describe("transaction hashes are unique", () => {
  it("refuses to attach one hash to two trades", async () => {
    const hash = "0x" + "ef".repeat(32);
    const first = await insertTrade(db.pool, intent());
    const second = await insertTrade(db.pool, intent());

    await markSubmitted(db.pool, first.id, hash);
    await expect(markSubmitted(db.pool, second.id, hash)).rejects.toThrow(/unique|duplicate/i);
  });
});

describe("cancellation", () => {
  it("abandons a pending intent", async () => {
    const trade = await insertTrade(db.pool, intent());
    expect((await markCancelled(db.pool, trade.id))?.status).toBe("cancelled");
  });

  /// Once a transaction is out there, cancelling the record would hide a trade that is really
  /// happening.
  it("refuses to cancel once a transaction has been submitted", async () => {
    const trade = await insertTrade(db.pool, intent());
    await markSubmitted(db.pool, trade.id, "0x" + "12".repeat(32));
    expect(await markCancelled(db.pool, trade.id)).toBeNull();
  });
});
