import {describe, expect, it} from "vitest";
import {TradeRejected, validateOpen} from "./validate";
import type {ChainState} from "./validate";

const NOW = 1_789_000_000;

const base: ChainState = {
  config: {
    enabled: true,
    maxAgeSec: 600,
    maxConfBps: 100,
    openFeeBps: 10,
    closeFeeBps: 10,
    maxOiUsd: 250_000n * 10n ** 18n,
    maxPositionUsd: 25_000n * 10n ** 18n,
  },
  price: {price: 77_337n * 10n ** 18n, conf: 17n * 10n ** 18n, publishTime: NOW - 10},
  openInterest: 0n,
  liquidityAvailable: 30_000_000n,
  usdcBalance: 10_000_000n,
  nowSeconds: NOW,
};

const open = (state: Partial<ChainState> = {}, collateral = 2_000_000n) =>
  validateOpen({collateral, isLong: true}, {...base, ...state});

const rejects = (code: string, state: Partial<ChainState> = {}, collateral = 2_000_000n) => {
  try {
    open(state, collateral);
  } catch (error) {
    expect(error).toBeInstanceOf(TradeRejected);
    expect((error as TradeRejected).code).toBe(code);
    return (error as TradeRejected).message;
  }
  throw new Error(`expected rejection with ${code}`);
};

describe("validateOpen", () => {
  it("accepts a trade the contract would accept", () => {
    expect(() => open()).not.toThrow();
  });

  it("rejects a disabled asset", () => {
    rejects("ASSET_DISABLED", {config: {...base.config, enabled: false}});
  });

  it("rejects a zero amount", () => {
    rejects("VALIDATION", {}, 0n);
  });

  /// The common case out of hours, not an outage. The message says so, because "price unavailable"
  /// sounds like something is broken when the market is simply shut.
  it("rejects a stale price and explains that the market is probably closed", () => {
    const message = rejects("PRICE_STALE", {
      price: {...base.price, publishTime: NOW - 50_000},
    });
    expect(message).toMatch(/closed/i);
  });

  it("accepts a price exactly at the staleness limit", () => {
    expect(() => open({price: {...base.price, publishTime: NOW - 600}})).not.toThrow();
  });

  it("rejects a confidence interval wider than the asset allows", () => {
    rejects("CONFIDENCE_TOO_WIDE", {
      price: {...base.price, conf: 5_000n * 10n ** 18n},
    });
  });

  it("rejects a trade the user cannot fund", () => {
    rejects("INSUFFICIENT_BALANCE", {usdcBalance: 1_000_000n});
  });

  it("rejects an amount too small to mint any units", () => {
    rejects("VALIDATION", {price: {...base.price, price: 10n ** 40n, conf: 0n}}, 1n);
  });

  /// Checked before the balance, so somebody over the cap is not told to top up first and then
  /// refused again for the real reason.
  it("rejects a position above the per-position cap before checking funds", () => {
    rejects("POSITION_CAP_EXCEEDED", {}, 26_000_000_000n);
  });

  it("rejects when this side of the market is already at its cap", () => {
    rejects("OPEN_INTEREST_CAP_EXCEEDED", {openInterest: 249_999n * 10n ** 18n});
  });

  /// A position that opens and then cannot close is a far worse experience than one that is refused
  /// up front.
  it("rejects when the pool could not cover the payout", () => {
    rejects("INSUFFICIENT_LIQUIDITY", {liquidityAvailable: 1_000_000n});
  });

  it("checks the asset before anything else, so a disabled market says so", () => {
    const message = rejects("ASSET_DISABLED", {
      config: {...base.config, enabled: false},
      price: {...base.price, publishTime: NOW - 99_999},
      usdcBalance: 0n,
    });
    expect(message).toMatch(/not open/i);
  });
});
