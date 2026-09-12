import {ApiException, defineHandler} from "@/lib/api-server/handler";
import {routes} from "@/lib/api-schema/routes";
import {toProfile} from "@/lib/api-server/profile";
import {getPool} from "@/lib/db/pool";
import {updateUserBio} from "@/lib/db/users";

export const GET = defineHandler(routes.getMe, async ({user}) => ({profile: toProfile(user)}));

export const PATCH = defineHandler(routes.updateMe, async ({user, body}) => {
  const updated = await updateUserBio(getPool(), user.id, body.bio);
  if (!updated) throw new ApiException("NOT_FOUND", "This account no longer exists.");
  return {profile: toProfile(updated)};
});
