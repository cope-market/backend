import {describe, expect, it} from "vitest";
import {Profile, PublicProfile} from "../api-schema/entities";
import {toProfile, toPublicProfile} from "./profile";
import type {User} from "../db/users";

const alice: User = {
  id: "6f1c9f40-0000-4000-8000-000000000001",
  privyId: "did:privy:alice",
  xHandle: "alice_macro",
  xName: "Alice",
  xAvatarUrl: null,
  walletAddress: "0xeeb3e0999D01f0d1Ed465513E414725a357F6ae4",
  bio: "macro",
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
};

const bob: User = {...alice, id: "6f1c9f40-0000-4000-8000-000000000002", xHandle: "bob_fx"};

describe("toProfile", () => {
  it("produces a value that satisfies the wire schema", () => {
    expect(Profile.safeParse(toProfile(alice)).success).toBe(true);
  });

  it("serialises the timestamp as ISO-8601", () => {
    expect(toProfile(alice).createdAt).toBe("2026-09-01T00:00:00.000Z");
  });

  /// Stats are placeholders until positions and follows exist. They are zero rather than absent, so
  /// a client never has to handle a missing field and nothing changes when real numbers arrive.
  it("returns zeroed stats rather than omitting them", () => {
    expect(toProfile(alice).stats.openPositions).toBe(0);
    expect(toProfile(alice).stats.realizedPnlUsd).toBe("0");
  });
});

describe("toPublicProfile", () => {
  it("satisfies the wire schema", () => {
    expect(PublicProfile.safeParse(toPublicProfile(alice, bob)).success).toBe(true);
  });

  /// "Not following" and "nobody is signed in" are different states, and a UI should be able to
  /// tell them apart rather than showing a Follow button to an anonymous visitor.
  it("reports no viewer relation for an anonymous request", () => {
    expect(toPublicProfile(alice, null).viewer).toBeNull();
  });

  it("recognises the viewer looking at their own profile", () => {
    expect(toPublicProfile(alice, alice).viewer?.isSelf).toBe(true);
    expect(toPublicProfile(alice, bob).viewer?.isSelf).toBe(false);
  });
});
