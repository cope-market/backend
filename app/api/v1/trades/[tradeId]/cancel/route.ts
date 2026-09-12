import {ApiException, defineHandler} from "@/lib/api-server/handler";
import {routes} from "@/lib/api-schema/routes";
import {toWireTrade} from "@/lib/api-server/trade-mappers";
import {getPool} from "@/lib/db/pool";
import {findTrade, markCancelled} from "@/lib/db/trades";

export const POST = defineHandler(routes.cancelTrade, async ({user, params}) => {
  const trade = await findTrade(getPool(), params.tradeId);
  if (!trade || trade.userId !== user.id) throw new ApiException("NOT_FOUND", "No such trade.");

  const cancelled = await markCancelled(getPool(), trade.id);
  if (!cancelled) {
    throw new ApiException(
      "CONFLICT",
      "That trade has already been submitted and cannot be cancelled.",
    );
  }
  return {trade: toWireTrade(cancelled)};
});
