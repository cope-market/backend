import {ApiException, defineHandler} from "@/lib/api-server/handler";
import {routes} from "@/lib/api-schema/routes";
import {toProfile} from "@/lib/api-server/profile";
import {bearerToken, fetchPrivyProfile, privyAppId, verifyPrivyToken} from "@/lib/auth/privy";
import {requireEnv} from "@/lib/env";
import {getPool} from "@/lib/db/pool";
import {upsertUser} from "@/lib/db/users";

/// Creates the account behind a verified token.
///
/// This is the one route that cannot use the handler's own authentication, because that requires a
/// user row and this is what creates it. It verifies the token itself, then asks Privy for the X
/// handle and embedded wallet, which the token does not carry.
export const POST = defineHandler(routes.createSession, async ({request}) => {
  const token = bearerToken(Object.fromEntries(request.headers.entries()));
  if (!token) throw new ApiException("UNAUTHORIZED", "createSession requires a bearer token.");

  const appId = privyAppId();
  const claims = await verifyPrivyToken(token, {appId});
  const identity = await fetchPrivyProfile(claims.privyId, {
    appId,
    appSecret: requireEnv("PRIVY_APP_SECRET"),
  });

  return {profile: toProfile(await upsertUser(getPool(), identity))};
});
