import type {z} from "zod";
import type {TradeIntent, Trade as WireTrade} from "../api-schema/entities";
import type {BuiltIntent} from "../trading/service";
import type {Trade} from "../db/trades";
import {chainConfig} from "../config/chain";

/// Maps internal values onto the wire. Every amount becomes a decimal string: a uint256 does not
/// survive JSON and a token amount in floating point is a rounding bug.

export function toWireIntent(
  trade: Trade,
  built: BuiltIntent,
  symbol: string,
): z.infer<typeof TradeIntent> {
  return {
    tradeId: trade.id,
    action: trade.action,
    status: trade.status,
    quote: {
      feedId: trade.feedId as `0x${string}`,
      symbol,
      isLong: trade.isLong ?? true,
      collateral: built.quote.collateral.toString(),
      netCollateral: built.quote.netCollateral.toString(),
      openFee: built.quote.openFee.toString(),
      openFeeBps: built.quote.openFeeBps,
      markPrice: built.quote.markPrice.toString(),
      entryPrice: built.quote.entryPrice.toString(),
      units: built.quote.units.toString(),
    },
    tx: {
      chainId: chainConfig().chainId,
      to: built.tx.to,
      data: built.tx.data,
      value: built.tx.value,
      maxFeePerGasWei: chainConfig().minMaxFeePerGasWei,
    },
    expiresAt: built.expiresAt.toISOString(),
  };
}

export function toWireTrade(trade: Trade): z.infer<typeof WireTrade> {
  return {
    tradeId: trade.id,
    action: trade.action,
    status: trade.status,
    feedId: trade.feedId as `0x${string}`,
    txHash: (trade.txHash as `0x${string}` | null) ?? null,
    tokenId: trade.tokenId?.toString() ?? null,
    thesisId: trade.thesisId,
    error: trade.error,
    createdAt: trade.createdAt.toISOString(),
    confirmedAt: trade.confirmedAt?.toISOString() ?? null,
  };
}
