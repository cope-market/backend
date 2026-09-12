import {ApiException, defineHandler} from "@/lib/api-server/handler";
import {routes} from "@/lib/api-schema/routes";
import {toWireThesis} from "@/lib/api-server/social-mappers";
import {getPool} from "@/lib/db/pool";
import {getFeed} from "@/lib/social/feed";

export const GET = defineHandler(routes.getFeed, async ({query, user}) => {
  try {
    const {theses, nextCursor} = await getFeed(getPool(), {
      tab: query.tab,
      viewerId: user?.id ?? null,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return {data: theses.map(toWireThesis), nextCursor};
  } catch (error) {
    if (error instanceof Error && /cursor/i.test(error.message)) {
      throw new ApiException("VALIDATION", "That pagination cursor is not valid.");
    }
    throw error;
  }
});
