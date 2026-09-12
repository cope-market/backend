import type {ErrorCode} from "../api-schema/primitives";
import type {AssetConfig, OraclePrice} from "../chain/reads";
import {confidenceBps, notionalUsd, quoteOpen} from "./quote";

/// Every reason the contract would reject an open, checked before a user signs.
///
/// A pure function over chain state so it can be tested exhaustively without a network. The chain
/// remains the authority -- the intent is simulated before it is handed over -- but a user who is
/// going to be rejected should find out before they pay gas, and with a message that says why.

export interface ChainState {
  config: AssetConfig;
  price: OraclePrice;
  openInterest: bigint;
  liquidityAvailable: bigint;
  usdcBalance: bigint;
  nowSeconds: number;
}

export interface OpenRequest {
  collateral: bigint;
  isLong: boolean;
}

export class TradeRejected extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TradeRejected";
  }
}

export function validateOpen(request: OpenRequest, state: ChainState): void {
  const {config, price} = state;

  if (!config.enabled) {
    throw new TradeRejected("ASSET_DISABLED", "This market is not open for new positions.");
  }

  if (request.collateral <= 0n) {
    throw new TradeRejected("VALIDATION", "Enter an amount greater than zero.");
  }

  // Market hours are the common case here, not an outage: FX, metals and equities stop publishing
  // when their market closes, and the contract refuses to price against a stale feed.
  const age = state.nowSeconds - price.publishTime;
  if (age > config.maxAgeSec) {
    throw new TradeRejected(
      "PRICE_STALE",
      `This market's price is ${age} seconds old and the limit is ${config.maxAgeSec}. ` +
        "The market is most likely closed.",
    );
  }

  const confBps = confidenceBps(price.price, price.conf);
  if (confBps > BigInt(config.maxConfBps)) {
    throw new TradeRejected(
      "CONFIDENCE_TOO_WIDE",
      "The price is too uncertain to trade against right now.",
    );
  }

  const quote = quoteOpen({
    price: price.price,
    conf: price.conf,
    collateral: request.collateral,
    openFeeBps: config.openFeeBps,
    isLong: request.isLong,
  });

  if (quote.units === 0n) {
    throw new TradeRejected("VALIDATION", "That amount is too small to open a position.");
  }

  const notional = notionalUsd(quote.netCollateral);
  if (notional > config.maxPositionUsd) {
    throw new TradeRejected("POSITION_CAP_EXCEEDED", "That is larger than the per-position limit.");
  }

  if (state.openInterest + notional > config.maxOiUsd) {
    throw new TradeRejected(
      "OPEN_INTEREST_CAP_EXCEEDED",
      "This side of the market is at its limit. Try the other side or a smaller size.",
    );
  }

  // Market limits are checked before the user's balance on purpose. Telling somebody they are
  // short of funds when the real problem is a cap invites them to top up and be refused again.
  if (state.usdcBalance < request.collateral) {
    throw new TradeRejected("INSUFFICIENT_BALANCE", "Not enough USDC for this position.");
  }

  // The pool is counterparty. If it could not cover a win, the position would open fine and refuse
  // to close, which is a far worse experience than being turned away now.
  if (state.liquidityAvailable < request.collateral) {
    throw new TradeRejected(
      "INSUFFICIENT_LIQUIDITY",
      "The liquidity pool cannot cover a position this size yet.",
    );
  }
}
