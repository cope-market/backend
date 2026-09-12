import {defineHandler} from "@/lib/api-server/handler";
import {routes} from "@/lib/api-schema/routes";
import {getPool} from "@/lib/db/pool";
import {leaderboard} from "@/lib/social/graph";

export const GET = defineHandler(routes.getLeaderboard, async ({query}) => {
  const entries = await leaderboard(getPool(), query.window);
  return {
    entries: entries.map((entry, index) => ({
      rank: index + 1,
      user: {
        handle: entry.handle,
        name: entry.name,
        avatarUrl: entry.avatarUrl,
        walletAddress: entry.walletAddress,
      },
      realizedPnlUsd: entry.realizedPnlUsd,
      closedPositions: entry.closedPositions,
      winRate: entry.winRate,
      copiesReceived: entry.copiesReceived,
    })),
  };
});
