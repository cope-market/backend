import type {z} from "zod";
import type {Comment as WireComment, Thesis as WireThesis} from "../api-schema/entities";
import type {Comment, Thesis} from "../social/theses";
import {findAsset} from "../config/assets";

const author = (a: Thesis["author"]) => ({
  handle: a.handle,
  name: a.name,
  avatarUrl: a.avatarUrl,
  walletAddress: a.walletAddress,
});

export function toWireThesis(thesis: Thesis): z.infer<typeof WireThesis> {
  return {
    id: thesis.id,
    author: author(thesis.author),
    event: thesis.event
      ? {
          tweetUrl: thesis.event.tweetUrl,
          authorHandle: thesis.event.authorHandle,
          authorName: thesis.event.authorName,
          html: thesis.event.html,
          fetchedAt: thesis.event.fetchedAt.toISOString(),
        }
      : null,
    feedId: thesis.feedId as `0x${string}`,
    // The catalogue owns the symbol; a feed id is a bytes32 and means nothing to a reader.
    symbol: findAsset(thesis.feedId)?.symbol ?? "unknown",
    stance: thesis.stance,
    title: thesis.title,
    body: thesis.body,
    createdAt: thesis.createdAt.toISOString(),
    likeCount: thesis.likeCount,
    commentCount: thesis.commentCount,
    copyCount: thesis.copyCount,
    // The client reads live P&L from the chain with this. It is never mirrored here.
    tokenId: thesis.tokenId?.toString() ?? null,
    copiedFromThesisId: thesis.copiedFromThesisId,
    viewerHasLiked: thesis.viewerHasLiked,
  };
}

export function toWireComment(comment: Comment): z.infer<typeof WireComment> {
  return {
    id: comment.id,
    author: author(comment.author),
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
  };
}
