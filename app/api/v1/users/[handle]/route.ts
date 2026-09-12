import {ApiException, defineHandler} from "@/lib/api-server/handler";
import {routes} from "@/lib/api-schema/routes";
import {toPublicProfileWithStats} from "@/lib/api-server/profile";
import {getPool} from "@/lib/db/pool";
import {findUserByHandle} from "@/lib/db/users";

export const GET = defineHandler(routes.getUser, async ({params, user}) => {
  const found = await findUserByHandle(getPool(), params.handle);
  if (!found) throw new ApiException("NOT_FOUND", `No user with handle ${params.handle}.`);
  return {profile: await toPublicProfileWithStats(getPool(), found, user)};
});
