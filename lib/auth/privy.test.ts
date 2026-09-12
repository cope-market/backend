import {SignJWT, exportJWK, generateKeyPair} from "jose";
import type {JWK} from "jose";
import {beforeAll, describe, expect, it} from "vitest";
import {AuthError, verifyPrivyToken} from "./privy";

const APP_ID = "cmtydcbsd02f00cjkdaadli5p";

let privateKey: CryptoKey;
let publicJwk: JWK;
let wrongPrivateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", {extractable: true});
  privateKey = pair.privateKey;
  publicJwk = await exportJWK(pair.publicKey);
  wrongPrivateKey = (await generateKeyPair("ES256", {extractable: true})).privateKey;
});

async function mint(
  overrides: {sub?: string; aud?: string; iss?: string; expiresIn?: string; key?: CryptoKey} = {},
) {
  return new SignJWT({})
    .setProtectedHeader({alg: "ES256"})
    .setSubject(overrides.sub ?? "did:privy:alice")
    .setAudience(overrides.aud ?? APP_ID)
    .setIssuer(overrides.iss ?? "privy.io")
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? "1h")
    .sign(overrides.key ?? privateKey);
}

const verify = (token: string) =>
  verifyPrivyToken(token, {appId: APP_ID, getPublicKey: async () => publicJwk});

describe("verifyPrivyToken", () => {
  it("accepts a well-formed token and returns the Privy identity", async () => {
    const claims = await verify(await mint());
    expect(claims.privyId).toBe("did:privy:alice");
  });

  /// The whole point of verification. A token signed by anyone else is not a token.
  it("rejects a token signed with the wrong key", async () => {
    await expect(verify(await mint({key: wrongPrivateKey}))).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects an expired token", async () => {
    await expect(verify(await mint({expiresIn: "-1h"}))).rejects.toThrow(/expired/i);
  });

  /// A token minted for a different Privy app is valid, correctly signed, and not ours. Accepting
  /// it would let another app's users sign in here.
  it("rejects a token for a different app", async () => {
    await expect(verify(await mint({aud: "some-other-app"}))).rejects.toThrow(/audience|app/i);
  });

  it("rejects a token from a different issuer", async () => {
    await expect(verify(await mint({iss: "evil.example"}))).rejects.toThrow(/issuer/i);
  });

  it.each([
    ["empty", ""],
    ["not a JWT", "hello"],
    ["truncated", "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJhIn0"],
  ])("rejects a %s token", async (_label, token) => {
    await expect(verify(token)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a token with no subject", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({alg: "ES256"})
      .setAudience(APP_ID)
      .setIssuer("privy.io")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
    await expect(verify(token)).rejects.toThrow(/subject/i);
  });
});

describe("bearer header parsing", () => {
  it("reads the token out of an Authorization header", async () => {
    const {bearerToken} = await import("./privy");
    expect(bearerToken({authorization: "Bearer abc"})).toBe("abc");
    expect(bearerToken({Authorization: "Bearer abc"})).toBe("abc");
  });

  it.each([
    ["absent", undefined],
    ["the wrong scheme", "Basic abc"],
    ["empty", "Bearer "],
  ])("returns null when the header is %s", async (_label, value) => {
    const {bearerToken} = await import("./privy");
    expect(bearerToken({authorization: value})).toBeNull();
  });
});

describe("fetchPrivyProfile", () => {
  const credentials = {appId: APP_ID, appSecret: "secret"};

  const respond = (body: unknown, status = 200) =>
    (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: {"content-type": "application/json"},
      })) as unknown as typeof fetch;

  const linked = {
    linked_accounts: [
      {type: "twitter_oauth", username: "alice_macro", name: "Alice", profile_picture_url: "u"},
      {type: "wallet", wallet_client_type: "privy", address: "0xabc"},
      {type: "wallet", wallet_client_type: "metamask", address: "0xdef"},
    ],
  };

  it("reads the X handle and the embedded wallet", async () => {
    const {fetchPrivyProfile} = await import("./privy");
    const profile = await fetchPrivyProfile("did:privy:alice", credentials, respond(linked));
    expect(profile.xHandle).toBe("alice_macro");
    expect(profile.walletAddress).toBe("0xabc");
  });

  /// A user may have linked an external wallet too. Picking that one would attribute their
  /// positions to an address they do not sign with here.
  it("ignores externally linked wallets", async () => {
    const {fetchPrivyProfile} = await import("./privy");
    const profile = await fetchPrivyProfile("did:privy:alice", credentials, respond(linked));
    expect(profile.walletAddress).not.toBe("0xdef");
  });

  it("fails when there is no linked X account", async () => {
    const {fetchPrivyProfile} = await import("./privy");
    await expect(
      fetchPrivyProfile("did:privy:alice", credentials, respond({linked_accounts: []})),
    ).rejects.toThrow(/X handle/i);
  });

  it("fails when there is no embedded wallet", async () => {
    const {fetchPrivyProfile} = await import("./privy");
    await expect(
      fetchPrivyProfile(
        "did:privy:alice",
        credentials,
        respond({linked_accounts: [{type: "twitter_oauth", username: "a"}]}),
      ),
    ).rejects.toThrow(/embedded wallet/i);
  });

  it("fails loudly when Privy rejects the credentials", async () => {
    const {fetchPrivyProfile} = await import("./privy");
    await expect(
      fetchPrivyProfile("did:privy:alice", credentials, respond({}, 401)),
    ).rejects.toThrow(/HTTP 401/);
  });
});

describe("test tokens", () => {
  const withEnv = async (env: Record<string, string | undefined>, run: () => Promise<void>) => {
    const previous = {...process.env};
    Object.assign(process.env, env);
    try {
      await run();
    } finally {
      process.env = previous;
    }
  };

  it("is accepted only when explicitly enabled outside production", async () => {
    const {testTokenPrivyId} = await import("./privy");
    await withEnv({NODE_ENV: "test", ALLOW_TEST_TOKENS: "1"}, async () => {
      expect(testTokenPrivyId("test:did:privy:alice")).toBe("did:privy:alice");
    });
  });

  /// Both conditions are required so the flag being set in the wrong place cannot open a hole.
  it("is refused in production even when the flag is set", async () => {
    const {testTokenPrivyId} = await import("./privy");
    await withEnv({NODE_ENV: "production", ALLOW_TEST_TOKENS: "1"}, async () => {
      expect(testTokenPrivyId("test:did:privy:alice")).toBeNull();
    });
  });

  it("is refused when the flag is absent", async () => {
    const {testTokenPrivyId} = await import("./privy");
    await withEnv({NODE_ENV: "test", ALLOW_TEST_TOKENS: undefined}, async () => {
      expect(testTokenPrivyId("test:did:privy:alice")).toBeNull();
    });
  });

  it("ignores a normal token", async () => {
    const {testTokenPrivyId} = await import("./privy");
    await withEnv({NODE_ENV: "test", ALLOW_TEST_TOKENS: "1"}, async () => {
      expect(testTokenPrivyId("eyJhbGciOiJFUzI1NiJ9.x.y")).toBeNull();
    });
  });

  it("rejects an empty identity", async () => {
    const {testTokenPrivyId} = await import("./privy");
    await withEnv({NODE_ENV: "test", ALLOW_TEST_TOKENS: "1"}, async () => {
      expect(testTokenPrivyId("test:")).toBeNull();
    });
  });
});
