import {ApiException, defineHandler} from "@/lib/api-server/handler";
import {routes} from "@/lib/api-schema/routes";
import {toWireThesis} from "@/lib/api-server/social-mappers";
import {findAsset} from "@/lib/config/assets";
import {getPool} from "@/lib/db/pool";
import {EmbedError, resolveTweet} from "@/lib/social/oembed";
import {createThesis} from "@/lib/social/theses";

export const POST = defineHandler(routes.createThesis, async ({user, body}) => {
  if (!findAsset(body.feedId)) throw new ApiException("NOT_FOUND", "That market is not listed.");

  let eventId: string | null = null;
  if (body.tweetUrl) {
    try {
      eventId = (await resolveTweet(getPool(), body.tweetUrl)).eventId;
    } catch (error) {
      if (error instanceof EmbedError) throw new ApiException("VALIDATION", error.message);
      throw error;
    }
  }

  // No position yet. It attaches when the backing trade confirms, because the user writes their
  // take before they sign.
  const thesis = await createThesis(getPool(), {
    userId: user.id,
    eventId,
    feedId: body.feedId,
    stance: body.stance,
    title: body.title,
    body: body.body,
    copiedFromThesisId: body.copiedFromThesisId,
  });

  return {thesis: toWireThesis(thesis)};
});
