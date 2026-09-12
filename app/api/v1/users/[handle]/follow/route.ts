import {ApiException, defineHandler} from "@/lib/api-server/handler";
import {routes} from "@/lib/api-schema/routes";
import {getPool} from "@/lib/db/pool";
import {findUserByHandle} from "@/lib/db/users";
import {followUser, unfollowUser} from "@/lib/social/graph";

export const POST = defineHandler(routes.followUser, async ({user, params}) => {
  const target = await findUserByHandle(getPool(), params.handle);
  if (!target) throw new ApiException("NOT_FOUND", `No user with handle ${params.handle}.`);

  const followed = await followUser(getPool(), user.id, target.id);
  if (!followed) throw new ApiException("VALIDATION", "You cannot follow yourself.");
  return {isFollowing: true};
});

export const DELETE = defineHandler(routes.unfollowUser, async ({user, params}) => {
  const target = await findUserByHandle(getPool(), params.handle);
  if (!target) throw new ApiException("NOT_FOUND", `No user with handle ${params.handle}.`);

  await unfollowUser(getPool(), user.id, target.id);
  return {isFollowing: false};
});
