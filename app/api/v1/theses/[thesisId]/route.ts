import {ApiException, defineHandler} from "@/lib/api-server/handler";
import {routes} from "@/lib/api-schema/routes";
import {toWireThesis} from "@/lib/api-server/social-mappers";
import {getPool} from "@/lib/db/pool";
import {findThesis} from "@/lib/social/theses";

export const GET = defineHandler(routes.getThesis, async ({params, user}) => {
  const thesis = await findThesis(getPool(), params.thesisId, user?.id ?? null);
  if (!thesis) throw new ApiException("NOT_FOUND", "No such thesis.");
  return {thesis: toWireThesis(thesis)};
});
