import {ApiException, defineHandler} from "@/lib/api-server/handler";
import {routes} from "@/lib/api-schema/routes";
import {getPool} from "@/lib/db/pool";
import {likeThesis, unlikeThesis} from "@/lib/social/theses";

export const POST = defineHandler(routes.likeThesis, async ({user, params}) => {
  const result = await likeThesis(getPool(), params.thesisId, user.id);
  if (!result) throw new ApiException("NOT_FOUND", "No such thesis.");
  return result;
});

export const DELETE = defineHandler(routes.unlikeThesis, async ({user, params}) => {
  const result = await unlikeThesis(getPool(), params.thesisId, user.id);
  if (!result) throw new ApiException("NOT_FOUND", "No such thesis.");
  return result;
});
