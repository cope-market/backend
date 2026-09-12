import {ApiException, defineHandler} from "@/lib/api-server/handler";
import {routes} from "@/lib/api-schema/routes";
import {toWireComment} from "@/lib/api-server/social-mappers";
import {getPool} from "@/lib/db/pool";
import {createComment, findThesis, listComments} from "@/lib/social/theses";

export const GET = defineHandler(routes.listComments, async ({params, query}) => {
  const {comments, nextCursor} = await listComments(
    getPool(),
    params.thesisId,
    query.limit,
    query.cursor ?? null,
  );
  return {data: comments.map(toWireComment), nextCursor};
});

export const POST = defineHandler(routes.createComment, async ({user, params, body}) => {
  if (!(await findThesis(getPool(), params.thesisId, null))) {
    throw new ApiException("NOT_FOUND", "No such thesis.");
  }
  return {
    comment: toWireComment(await createComment(getPool(), params.thesisId, user.id, body.body)),
  };
});
