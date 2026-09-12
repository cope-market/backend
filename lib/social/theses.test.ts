import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {createTestDatabase, type TestDatabase} from "../db/testing";
import {upsertUser} from "../db/users";
import {
  attachPosition,
  createComment,
  createThesis,
  decodeCursor,
  encodeCursor,
  findThesis,
  likeThesis,
  listComments,
  unlikeThesis,
} from "./theses";

let db: TestDatabase;
let alice: string;
let bob: string;

const FEED = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

beforeAll(async () => {
  db = await createTestDatabase();
  alice = (
    await upsertUser(db.pool, {
      privyId: "did:privy:alice",
      xHandle: "alice_macro",
      xName: "Alice",
      xAvatarUrl: null,
      walletAddress: "0x1111111111111111111111111111111111111111",
    })
  ).id;
  bob = (
    await upsertUser(db.pool, {
      privyId: "did:privy:bob",
      xHandle: "bob_fx",
      xName: "Bob",
      xAvatarUrl: null,
      walletAddress: "0x2222222222222222222222222222222222222222",
    })
  ).id;
});
afterAll(() => db.drop());

const post = (userId = alice, copiedFrom: string | null = null) =>
  createThesis(db.pool, {
    userId,
    eventId: null,
    feedId: FEED,
    stance: "bullish",
    title: "Cuts are coming",
    body: "Dot plot moved.",
    copiedFromThesisId: copiedFrom,
  });

describe("createThesis", () => {
  it("stores a thesis with its author and no position yet", async () => {
    const thesis = await post();
    expect(thesis.author.handle).toBe("alice_macro");
    expect(thesis.tokenId).toBeNull();
    expect(thesis.likeCount).toBe(0);
  });

  /// The counter and the rows pointing at the original are written together, so the number on
  /// screen cannot disagree with reality.
  it("bumps the original's copy count when a thesis is a copy", async () => {
    const original = await post(alice);
    await post(bob, original.id);
    await post(bob, original.id);

    const refreshed = await findThesis(db.pool, original.id, null);
    expect(refreshed?.copyCount).toBe(2);
  });
});

describe("attachPosition", () => {
  /// A user writes their take, then signs. The position arrives when the trade confirms.
  it("attaches a position after the fact", async () => {
    const thesis = await post();
    await attachPosition(db.pool, thesis.id, 42n);
    expect((await findThesis(db.pool, thesis.id, null))?.tokenId).toBe(42n);
  });

  it("does not overwrite a position already attached", async () => {
    const thesis = await post();
    await attachPosition(db.pool, thesis.id, 1n);
    await attachPosition(db.pool, thesis.id, 2n);
    expect((await findThesis(db.pool, thesis.id, null))?.tokenId).toBe(1n);
  });
});

describe("likes", () => {
  /// Double-tapping is the normal case on a phone, not an edge case.
  it("is idempotent", async () => {
    const thesis = await post();
    await likeThesis(db.pool, thesis.id, bob);
    const second = await likeThesis(db.pool, thesis.id, bob);
    expect(second?.likeCount).toBe(1);
  });

  it("counts distinct people", async () => {
    const thesis = await post();
    await likeThesis(db.pool, thesis.id, alice);
    const result = await likeThesis(db.pool, thesis.id, bob);
    expect(result?.likeCount).toBe(2);
  });

  it("unliking is also idempotent and never goes negative", async () => {
    const thesis = await post();
    await likeThesis(db.pool, thesis.id, bob);
    await unlikeThesis(db.pool, thesis.id, bob);
    const again = await unlikeThesis(db.pool, thesis.id, bob);
    expect(again?.likeCount).toBe(0);
  });

  /// The viewer's own state, so a client can render a filled heart without a second request.
  it("reports whether the viewer has liked, and null when anonymous", async () => {
    const thesis = await post();
    await likeThesis(db.pool, thesis.id, bob);

    expect((await findThesis(db.pool, thesis.id, bob))?.viewerHasLiked).toBe(true);
    expect((await findThesis(db.pool, thesis.id, alice))?.viewerHasLiked).toBe(false);
    expect((await findThesis(db.pool, thesis.id, null))?.viewerHasLiked).toBeNull();
  });
});

describe("comments", () => {
  it("stores a comment and moves the counter", async () => {
    const thesis = await post();
    const comment = await createComment(db.pool, thesis.id, bob, "Disagree on timing");
    expect(comment.author.handle).toBe("bob_fx");
    expect((await findThesis(db.pool, thesis.id, null))?.commentCount).toBe(1);
  });

  it("returns comments newest first", async () => {
    const thesis = await post();
    await createComment(db.pool, thesis.id, alice, "first");
    await createComment(db.pool, thesis.id, bob, "second");

    const {comments} = await listComments(db.pool, thesis.id, 10, null);
    expect(comments[0]?.body).toBe("second");
  });

  /// Keyset pagination, so a comment posted mid-scroll does not make a reader see a row twice or
  /// skip one.
  it("pages without repeating or skipping rows", async () => {
    const thesis = await post();
    for (let i = 0; i < 5; i++) await createComment(db.pool, thesis.id, alice, `c${i}`);

    const first = await listComments(db.pool, thesis.id, 2, null);
    expect(first.comments).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await listComments(db.pool, thesis.id, 2, first.nextCursor);
    const ids = [...first.comments, ...second.comments].map((c) => c.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("reports no cursor on the last page", async () => {
    const thesis = await post();
    await createComment(db.pool, thesis.id, alice, "only");
    expect((await listComments(db.pool, thesis.id, 10, null)).nextCursor).toBeNull();
  });
});

describe("cursors", () => {
  it("round-trips a timestamp and an id", () => {
    const now = new Date("2026-09-12T13:00:00.000Z");
    const [time, id] = decodeCursor(encodeCursor(now, "abc"));
    expect(time).toBe(now.toISOString());
    expect(id).toBe("abc");
  });

  it("rejects a malformed cursor", () => {
    expect(() => decodeCursor("bm90LWEtY3Vyc29y")).toThrow(/malformed/i);
  });
});
