import type {Address, Hex} from "viem";
import {ApiException, defineHandler} from "@/lib/api-server/handler";
import {routes} from "@/lib/api-schema/routes";
import {toWireTrade} from "@/lib/api-server/trade-mappers";
import {chainAdapter} from "@/lib/chain/adapter";
import {getPool} from "@/lib/db/pool";
import {findTrade, markConfirmed, markFailed, markSubmitted} from "@/lib/db/trades";
import {settleFromReceipt} from "@/lib/trading/service";
import {attachPosition} from "@/lib/social/theses";

export const POST = defineHandler(routes.confirmTrade, async ({user, params, body}) => {
  const pool = getPool();
  const trade = await findTrade(pool, params.tradeId);

  if (!trade || trade.userId !== user.id) {
    throw new ApiException("NOT_FOUND", "No such trade.");
  }
  if (trade.status === "confirmed") return {trade: toWireTrade(trade)};
  if (trade.status === "cancelled") {
    throw new ApiException("CONFLICT", "That trade was cancelled.");
  }

  const submitted = await markSubmitted(pool, trade.id, body.txHash);
  if (!submitted) throw new ApiException("CONFLICT", "That trade can no longer be confirmed.");

  try {
    const settled = await settleFromReceipt(chainAdapter(), body.txHash as Hex, {
      wallet: user.walletAddress as Address,
      action: trade.action,
    });
    const confirmed = (await markConfirmed(pool, trade.id, settled.tokenId))!;

    // The thesis was written before the signature. This is where the position catches up with it.
    if (trade.action === "open" && trade.thesisId && settled.tokenId !== null) {
      await attachPosition(pool, trade.thesisId, settled.tokenId);
    }

    return {trade: toWireTrade(confirmed)};
  } catch (error) {
    // A revert or a mismatch is recorded rather than left pending, so the client stops polling and
    // the user sees why.
    if (error instanceof ApiException && error.code !== "NOT_FOUND") {
      await markFailed(pool, trade.id, error.message);
    }
    throw error;
  }
});
