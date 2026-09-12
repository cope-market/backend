import {describe, expect, it} from "vitest";
import {assetCatalogue, findAsset} from "./assets";
import {chainConfig} from "./chain";

describe("chainConfig", () => {
  it("describes Arc and its deployed contracts", () => {
    const config = chainConfig();
    expect(config.chainId).toBe(5042002);
    expect(config.usdcDecimals).toBe(6);
    expect(config.nativeCurrency.decimals).toBe(18);
  });

  /// The two decimal scales are the easiest thing to get wrong on Arc, so both are served and each
  /// is labelled.
  it("distinguishes the 18-decimal native currency from the 6-decimal ERC-20 view", () => {
    const config = chainConfig();
    expect(config.nativeCurrency.decimals).not.toBe(config.usdcDecimals);
  });

  it("names the gas floor Arc enforces", () => {
    expect(chainConfig().minMaxFeePerGasWei).toBe("20000000000");
  });

  it("reads contract addresses from the environment", () => {
    expect(chainConfig().contracts.syntheticVault).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

describe("assetCatalogue", () => {
  it("lists the entitled feeds", () => {
    const assets = assetCatalogue();
    expect(assets).toHaveLength(4);
    expect(assets.map((a) => a.symbol)).toEqual(["EUR/USD", "XAU/USD", "BTC/USD", "TSLA/USD"]);
  });

  it("gives every asset a distinct feed id", () => {
    const ids = assetCatalogue().map((a) => a.feedId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("finds an asset by feed id, case-insensitively", () => {
    const btc = assetCatalogue()[2]!;
    expect(findAsset(btc.feedId.toUpperCase())?.symbol).toBe("BTC/USD");
  });

  it("returns null for a feed it does not carry", () => {
    expect(findAsset("0x" + "00".repeat(32))).toBeNull();
  });
});
