import type {Address} from "viem";
import {ApiException, defineHandler} from "@/lib/api-server/handler";
import {routes} from "@/lib/api-schema/routes";
import {toWireIntent} from "@/lib/api-server/trade-mappers";
import {chainAdapter} from "@/lib/chain/adapter";
import {findAsset} from "@/lib/config/assets";
import {getPool} from "@/lib/db/pool";
import {insertTrade} from "@/lib/db/trades";
import {buildCloseIntent} from "@/lib/trading/service";

export const POST = defineHandler(routes.createCloseIntent, async ({user, params}) => {
  let tokenId: bigint;
  try {
    tokenId = BigInt(params.tokenId);
  } catch {
    throw new ApiException("VALIDATION", "Position id must be a whole number.");
  }

  const chain = chainAdapter();
  const built = await buildCloseIntent(chain, tokenId, user.walletAddress as Address);
  const position = await chain.readPosition(tokenId);
  const asset = findAsset(position.feedId);

  const trade = await insertTrade(getPool(), {
    userId: user.id,
    action: "close",
    feedId: position.feedId,
    isLong: position.isLong,
    collateral: position.collateral,
    tokenId,
    copiedFromTokenId: null,
    quote: {entryPrice: built.quote.entryPrice.toString(), units: built.quote.units.toString()},
    tx: built.tx,
    thesisId: null,
    expiresAt: built.expiresAt,
  });

  return {intent: toWireIntent(trade, built, asset?.symbol ?? "unknown")};
});
