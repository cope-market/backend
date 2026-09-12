import {describe, expect, it} from "vitest";
import {
  readAssetConfig,
  readLastPublishTime,
  readLiquidityAvailable,
  readOpenInterest,
  readPrice,
} from "./reads";
import {assetCatalogue} from "../config/assets";
import type {Hex} from "viem";

/// Against the live Arc testnet deployment. These prove the ABIs match the deployed contracts,
/// which is the failure a unit test with a mocked client cannot catch.
///
///   CHAIN_TESTS=1 npm test
const enabled = process.env["CHAIN_TESTS"] === "1";
const BTC = assetCatalogue().find((a) => a.symbol === "BTC/USD")!.feedId as Hex;

describe.skipIf(!enabled)("reads against Arc testnet", () => {
  it("reads an asset config the deploy script wrote", async () => {
    const config = await readAssetConfig(BTC);
    expect(config.enabled).toBe(true);
    expect(config.maxAgeSec).toBeGreaterThan(0);
    // Contract-enforced caps; see the contracts repo. Zero would mean the asset cannot be traded.
    expect(config.maxPositionUsd).toBeGreaterThan(0n);
    expect(config.openFeeBps).toBeLessThanOrEqual(500);
  });

  it("reads a price with its confidence interval", async () => {
    const price = await readPrice(BTC);
    expect(price.price).toBeGreaterThan(0n);
    expect(price.publishTime).toBeGreaterThan(0);
  });

  it("reports when a feed was last written", async () => {
    expect(await readLastPublishTime(BTC)).toBeGreaterThan(0);
  });

  it("reads open interest for both sides", async () => {
    expect(await readOpenInterest(BTC, true)).toBeGreaterThanOrEqual(0n);
    expect(await readOpenInterest(BTC, false)).toBeGreaterThanOrEqual(0n);
  });

  /// The pool has to be able to cover a winning close, so the API checks this before quoting.
  it("reads liquidity available to pay out", async () => {
    expect(await readLiquidityAvailable()).toBeGreaterThan(0n);
  });

  /// An unconfigured feed must report disabled rather than throwing, so the API can return a clear
  /// error instead of a 500.
  it("reports an unknown feed as disabled", async () => {
    const config = await readAssetConfig(`0x${"11".repeat(32)}` as Hex);
    expect(config.enabled).toBe(false);
  });
});
