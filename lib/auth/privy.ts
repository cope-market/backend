import {createLocalJWKSet, importJWK, jwtVerify} from "jose";
import type {JWK, JWTPayload, KeyObject} from "jose";
import {requireEnv} from "../env";

/// Verifies Privy access tokens.
///
/// Verification is a local signature check against Privy's public key, not a call to their API. A
/// network round trip per request would turn a signature check into both a latency cost and an
/// availability dependency: Privy having a bad minute would log out every user.

const PRIVY_ISSUER = "privy.io";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface PrivyClaims {
  privyId: string;
  sessionId: string | null;
  expiresAt: Date;
}

export interface VerifyOptions {
  appId: string;
  /// Supplied by tests. Production resolves Privy's published key and caches it.
  getPublicKey?: () => Promise<JWK>;
}

let cachedKeys: ReturnType<typeof createLocalJWKSet> | undefined;
let cachedForAppId: string | undefined;

/// Privy publishes one key per app. Fetched once and reused; a rotation is handled by restarting,
/// which is acceptable for a key that rotates on the order of never.
async function remoteKeySet(appId: string) {
  if (cachedKeys && cachedForAppId === appId) return cachedKeys;

  const response = await fetch(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`);
  if (!response.ok) {
    throw new AuthError(`Could not fetch Privy signing keys (HTTP ${response.status}).`);
  }
  cachedKeys = createLocalJWKSet((await response.json()) as {keys: JWK[]});
  cachedForAppId = appId;
  return cachedKeys;
}

/// Escape hatch for automated verification against a real deployment, where no browser exists to
/// mint a Privy token.
///
/// Requires BOTH a non-production NODE_ENV and ALLOW_TEST_TOKENS=1. Either alone is not enough, so
/// the variable being set in the wrong place cannot open a hole, and neither can NODE_ENV being
/// unset. It is refused in production regardless of the flag.
export function testTokenPrivyId(token: string): string | null {
  if (!token.startsWith("test:")) return null;
  if (process.env["NODE_ENV"] === "production") return null;
  if (process.env["ALLOW_TEST_TOKENS"] !== "1") return null;

  const privyId = token.slice("test:".length);
  return privyId.length > 0 ? privyId : null;
}

export async function verifyPrivyToken(
  token: string,
  options: VerifyOptions,
): Promise<PrivyClaims> {
  if (!token) throw new AuthError("No access token was supplied.");

  const testPrivyId = testTokenPrivyId(token);
  if (testPrivyId) {
    console.warn(`ACCEPTING TEST TOKEN for ${testPrivyId}. This must never happen in production.`);
    return {privyId: testPrivyId, sessionId: null, expiresAt: new Date(Date.now() + 60_000)};
  }

  const key = options.getPublicKey
    ? ((await importJWK(await options.getPublicKey(), "ES256")) as KeyObject)
    : await remoteKeySet(options.appId);

  let payload: JWTPayload;
  try {
    ({payload} = await jwtVerify(token, key as Parameters<typeof jwtVerify>[1], {
      issuer: PRIVY_ISSUER,
      audience: options.appId,
      algorithms: ["ES256"],
    }));
  } catch (cause) {
    const code = (cause as {code?: string}).code;
    if (code === "ERR_JWT_EXPIRED") throw new AuthError("Access token has expired.");
    if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
      const claim = (cause as {claim?: string}).claim;
      if (claim === "aud") throw new AuthError("Access token was issued for a different app.");
      if (claim === "iss") throw new AuthError("Access token has an unexpected issuer.");
    }
    throw new AuthError("Access token is not valid.");
  }

  if (!payload.sub) throw new AuthError("Access token has no subject.");

  return {
    privyId: payload.sub,
    sessionId: typeof payload["sid"] === "string" ? payload["sid"] : null,
    expiresAt: new Date((payload.exp ?? 0) * 1000),
  };
}

/// Pulls the token out of an Authorization header. Returns null rather than throwing, so a caller
/// can distinguish "anonymous request" from "bad credentials".
export function bearerToken(headers: Record<string, string | undefined>): string | null {
  const header = headers["authorization"] ?? headers["Authorization"];
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export function privyAppId(): string {
  return requireEnv("PRIVY_APP_ID");
}

/// Fetches the profile behind a Privy identity: the linked X account and the embedded wallet.
///
/// This is a network call, so it happens once at sign-in rather than on every request. The access
/// token carries only the identity; the handle, name, avatar and wallet address live in Privy.
export interface PrivyProfile {
  privyId: string;
  xHandle: string;
  xName: string;
  xAvatarUrl: string | null;
  walletAddress: string;
}

interface PrivyAccount {
  type: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
  address?: string;
  wallet_client_type?: string;
  chain_type?: string;
}

export async function fetchPrivyProfile(
  privyId: string,
  credentials: {appId: string; appSecret: string},
  doFetch: typeof fetch = fetch,
): Promise<PrivyProfile> {
  const authorization = Buffer.from(`${credentials.appId}:${credentials.appSecret}`).toString(
    "base64",
  );

  const response = await doFetch(`https://auth.privy.io/api/v1/users/${privyId}`, {
    headers: {
      authorization: `Basic ${authorization}`,
      "privy-app-id": credentials.appId,
    },
  });

  if (!response.ok) {
    throw new AuthError(`Could not read the Privy profile (HTTP ${response.status}).`);
  }

  const body = (await response.json()) as {linked_accounts?: PrivyAccount[]};
  const accounts = body.linked_accounts ?? [];

  const twitter = accounts.find((account) => account.type === "twitter_oauth");
  if (!twitter?.username) {
    throw new AuthError("This Privy account has no linked X handle.");
  }

  // The embedded wallet is the one this app creates and the user signs with. An externally linked
  // wallet is not it, and picking the wrong one would attribute positions to the wrong address.
  const wallet = accounts.find(
    (account) => account.type === "wallet" && account.wallet_client_type === "privy",
  );
  if (!wallet?.address) {
    throw new AuthError("This Privy account has no embedded wallet.");
  }

  return {
    privyId,
    xHandle: twitter.username,
    xName: twitter.name ?? twitter.username,
    xAvatarUrl: twitter.profile_picture_url ?? null,
    walletAddress: wallet.address,
  };
}
