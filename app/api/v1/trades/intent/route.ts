import type {Address, Hex} from "viem";
import {ApiException, defineHandler} from "@/lib/api-server/handler";
import {routes} from "@/lib/api-schema/routes";
import {toWireIntent} from "@/lib/api-server/trade-mappers";
import {chainAdapter} from "@/lib/chain/adapter";
import {findAsset} from "@/lib/config/assets";
import {getPool} from "@/lib/db/pool";
import {insertTrade} from "@/lib/db/trades";
import {buildOpenIntent} from "@/lib/trading/service";

export const POST = defineHandler(routes.createTradeIntent, async ({user, body}) => {
  const asset = findAsset(body.feedId);
  if (!asset) throw new ApiException("NOT_FOUND", "That market is not listed.");

  const built = await buildOpenIntent(chainAdapter(), {
    feedId: body.feedId as Hex,
    isLong: body.isLong,
    collateral: BigInt(body.collateral),
    wallet: user.walletAddress as Address,
    copiedFromTokenId: body.copiedFromTokenId ? BigInt(body.copiedFromTokenId) : null,
  });

  // Recorded before the transaction is handed over, so a client that loses the response can still
  // find out what it started.
  const trade = await insertTrade(getPool(), {
    userId: user.id,
    action: "open",
    feedId: body.feedId,
    isLong: body.isLong,
    collateral: BigInt(body.collateral),
    tokenId: null,
    copiedFromTokenId: body.copiedFromTokenId ? BigInt(body.copiedFromTokenId) : null,
    quote: toSerialisable(built.quote),
    tx: built.tx,
    thesisId: body.thesisId,
    expiresAt: built.expiresAt,
  });

  return {intent: toWireIntent(trade, built, asset.symbol)};
});

function toSerialisable(quote: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(quote).map(([key, value]) => [
      key,
      typeof value === "bigint" ? value.toString() : value,
    ]),
  );
}
