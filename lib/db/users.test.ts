import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {createTestDatabase, type TestDatabase} from "./testing";
import {findUserByHandle, findUserByPrivyId, updateUserBio, upsertUser} from "./users";

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(() => db.drop());

const identity = {
  privyId: "did:privy:alice",
  xHandle: "alice_macro",
  xName: "Alice",
  xAvatarUrl: "https://img.example/a.jpg",
  walletAddress: "0xeeb3e0999D01f0d1Ed465513E414725a357F6ae4",
};

describe("upsertUser", () => {
  it("creates a user on first sight", async () => {
    const user = await upsertUser(db.pool, identity);
    expect(user.xHandle).toBe("alice_macro");
    expect(user.bio).toBeNull();
    expect(user.id).toBeTruthy();
  });

  /// Every sign-in calls this. The second call must return the same user, not create another.
  it("returns the same user on a second sign-in", async () => {
    const first = await upsertUser(db.pool, identity);
    const second = await upsertUser(db.pool, identity);
    expect(second.id).toBe(first.id);
  });

  /// A handle or display name can change on X, and the wallet is whatever Privy reports now.
  it("refreshes the details Privy supplies", async () => {
    const before = await upsertUser(db.pool, identity);
    const after = await upsertUser(db.pool, {
      ...identity,
      xHandle: "alice_macro2",
      xName: "Alice Two",
      xAvatarUrl: null,
    });

    expect(after.id).toBe(before.id);
    expect(after.xHandle).toBe("alice_macro2");
    expect(after.xName).toBe("Alice Two");
    expect(after.xAvatarUrl).toBeNull();
  });

  /// Bio is ours, not Privy's. A sign-in must not wipe what the user wrote.
  it("leaves the bio alone", async () => {
    const user = await upsertUser(db.pool, identity);
    await updateUserBio(db.pool, user.id, "macro, mostly wrong");

    const after = await upsertUser(db.pool, identity);
    expect(after.bio).toBe("macro, mostly wrong");
  });
});

describe("lookups", () => {
  it("finds a user by handle, case-insensitively", async () => {
    await upsertUser(db.pool, {
      ...identity,
      privyId: "did:privy:bob",
      xHandle: "bob_fx",
      walletAddress: "0x311F471eF24971B6728F8b628C82e5396d222Fa9",
    });
    expect((await findUserByHandle(db.pool, "BOB_FX"))?.xHandle).toBe("bob_fx");
  });

  it("finds a user by Privy id", async () => {
    expect((await findUserByPrivyId(db.pool, "did:privy:bob"))?.xHandle).toBe("bob_fx");
  });

  it("returns null for someone who does not exist", async () => {
    expect(await findUserByHandle(db.pool, "nobody")).toBeNull();
    expect(await findUserByPrivyId(db.pool, "did:privy:nobody")).toBeNull();
  });
});

describe("updateUserBio", () => {
  it("sets and clears the bio", async () => {
    const user = await upsertUser(db.pool, {
      ...identity,
      privyId: "did:privy:carol",
      xHandle: "carol",
      walletAddress: "0x1111111111111111111111111111111111111111",
    });

    expect((await updateUserBio(db.pool, user.id, "hello"))?.bio).toBe("hello");
    expect((await updateUserBio(db.pool, user.id, null))?.bio).toBeNull();
  });

  it("returns null for a user who does not exist", async () => {
    expect(await updateUserBio(db.pool, "6f1c9f40-0000-4000-8000-000000000000", "x")).toBeNull();
  });
});
