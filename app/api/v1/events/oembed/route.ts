import {ApiException, defineHandler} from "@/lib/api-server/handler";
import {routes} from "@/lib/api-schema/routes";
import {getPool} from "@/lib/db/pool";
import {EmbedError, resolveTweet} from "@/lib/social/oembed";

export const POST = defineHandler(routes.resolveTweet, async ({body}) => {
  try {
    const {embed} = await resolveTweet(getPool(), body.tweetUrl);
    return {
      event: {
        tweetUrl: embed.tweetUrl,
        authorHandle: embed.authorHandle,
        authorName: embed.authorName,
        html: embed.html,
        fetchedAt: embed.fetchedAt.toISOString(),
      },
    };
  } catch (error) {
    // A deleted or private tweet is something a user pasted, not a server fault.
    if (error instanceof EmbedError) throw new ApiException("VALIDATION", error.message);
    throw error;
  }
});
