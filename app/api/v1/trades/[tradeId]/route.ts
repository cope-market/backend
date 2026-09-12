import {ApiException, defineHandler} from "@/lib/api-server/handler";
import {routes} from "@/lib/api-schema/routes";
import {toWireTrade} from "@/lib/api-server/trade-mappers";
import {getPool} from "@/lib/db/pool";
import {findTrade} from "@/lib/db/trades";

export const GET = defineHandler(routes.getTrade, async ({user, params}) => {
  const trade = await findTrade(getPool(), params.tradeId);
  if (!trade || trade.userId !== user.id) throw new ApiException("NOT_FOUND", "No such trade.");
  return {trade: toWireTrade(trade)};
});
