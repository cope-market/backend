import {describe, expect, it, vi} from "vitest";
import {encodeEventTopics, encodeFunctionData} from "viem";
import type {Address, Hex} from "viem";
import {syntheticVaultAbi} from "../chain/abi";
import {buildCloseIntent, buildOpenIntent, settleFromReceipt} from "./service";
import type {ChainAdapter, Receipt} from "./service";
import {ApiException} from "../api-server/handler";

const VAULT = "0x2c720283A8Bbb5CC5b13C0C4Bcf2300826286c47" as Address;
const WALLET = "0xeeb3e0999D01f0d1Ed465513E414725a357F6ae4" as Address;
const OTHER = "0x311F471eF24971B6728F8b628C82e5396d222Fa9" as Address;
const FEED = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43" as Hex;
const NOW = 1_789_000_000;

function adapter(over: Partial<ChainAdapter> = {}): ChainAdapter {
  return {
    vaultAddress: VAULT,
    readAssetConfig: async () => ({
      enabled: true,
      maxAgeSec: 600,
      maxConfBps: 100,
      openFeeBps: 10,
      closeFeeBps: 10,
      maxOiUsd: 250_000n * 10n ** 18n,
      maxPositionUsd: 25_000n * 10n ** 18n,
    }),
    readPrice: async () => ({
      price: 77_337n * 10n ** 18n,
      conf: 17n * 10n ** 18n,
      publishTime: NOW - 10,
    }),
    readOpenInterest: async () => 0n,
    readLiquidityAvailable: async () => 30_000_000n,
    readUsdcBalance: async () => 10_000_000n,
    readPosition: async () => ({
      feedId: FEED,
      isLong: true,
      openedAt: NOW - 100,
      collateral: 1_998_000n,
      units: 25_828_806_526_949n,
      entryPrice: 77_355n * 10n ** 18n,
      author: WALLET,
      copiedFromId: 0n,
      copyAuthor: "0x0000000000000000000000000000000000000000" as Address,
      authorFeeBps: 0,
    }),
    readPositionOwner: async () => WALLET,
    simulate: async () => {},
    getReceipt: async () => null,
    now: () => NOW,
    ...over,
  };
}

const openInput = {
  feedId: FEED,
  isLong: true,
  collateral: 2_000_000n,
  wallet: WALLET,
  copiedFromTokenId: null,
};

describe("buildOpenIntent", () => {
  it("quotes the trade and targets the vault", async () => {
    const intent = await buildOpenIntent(adapter(), openInput);
    expect(intent.tx.to).toBe(VAULT);
    expect(intent.quote.netCollateral).toBe(1_998_000n);
    expect(intent.quote.entryPrice).toBe(77_354n * 10n ** 18n);
    expect(intent.quote.units).toBeGreaterThan(0n);
  });

  /// A client showing the mid as the entry price shows a fill the user will not get.
  it("quotes an entry above the mark for a long", async () => {
    const intent = await buildOpenIntent(adapter(), openInput);
    expect(intent.quote.entryPrice).toBeGreaterThan(intent.quote.markPrice);
  });

  it("quotes an entry below the mark for a short", async () => {
    const intent = await buildOpenIntent(adapter(), {...openInput, isLong: false});
    expect(intent.quote.entryPrice).toBeLessThan(intent.quote.markPrice);
  });

  it("encodes a call the vault would accept", async () => {
    const intent = await buildOpenIntent(adapter(), openInput);
    const expected = encodeFunctionData({
      abi: syntheticVaultAbi,
      functionName: "open",
      args: [FEED, true, 2_000_000n, 0n, []],
    });
    expect(intent.tx.data).toBe(expected);
  });

  it("expires the quote", async () => {
    const intent = await buildOpenIntent(adapter(), openInput);
    expect(intent.expiresAt.getTime()).toBe((NOW + 30) * 1000);
  });

  /// Validation turns a revert selector into something a person can act on.
  it("turns a rejection into an API error with its own code", async () => {
    const chain = adapter({
      readAssetConfig: async () => ({
        enabled: false,
        maxAgeSec: 600,
        maxConfBps: 100,
        openFeeBps: 10,
        closeFeeBps: 10,
        maxOiUsd: 1n,
        maxPositionUsd: 1n,
      }),
    });
    await expect(buildOpenIntent(chain, openInput)).rejects.toMatchObject({
      code: "ASSET_DISABLED",
    });
  });

  /// The contract is the authority. Validation is a courtesy; this is the proof.
  it("simulates the call before handing it over", async () => {
    const simulate = vi.fn(async () => {});
    await buildOpenIntent(adapter({simulate}), openInput);
    expect(simulate).toHaveBeenCalledOnce();
  });

  it("refuses to hand over a call that would revert", async () => {
    const chain = adapter({
      simulate: async () => {
        throw new ApiException("CONFLICT", "would revert");
      },
    });
    await expect(buildOpenIntent(chain, openInput)).rejects.toThrow(/revert/);
  });
});

describe("buildCloseIntent", () => {
  it("builds a close for a position the caller owns", async () => {
    const intent = await buildCloseIntent(adapter(), 1n, WALLET);
    expect(intent.tx.to).toBe(VAULT);
  });

  it("refuses a position somebody else owns", async () => {
    await expect(buildCloseIntent(adapter(), 1n, OTHER)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("reports a position that does not exist", async () => {
    const chain = adapter({
      readPositionOwner: async () => {
        throw new Error("ERC721NonexistentToken");
      },
    });
    await expect(buildCloseIntent(chain, 99n, WALLET)).rejects.toMatchObject({code: "NOT_FOUND"});
  });

  /// Out of hours this is the common case, and a user needs to know the position is not stuck.
  it("explains that a closed market blocks closing too", async () => {
    const chain = adapter({
      readPrice: async () => ({price: 1n, conf: 0n, publishTime: NOW - 100_000}),
    });
    await expect(buildCloseIntent(chain, 1n, WALLET)).rejects.toThrow(/reopens/i);
  });

  /// Confidence moves against the trader on exit as well as entry.
  it("quotes an exit below the mark for a long", async () => {
    const intent = await buildCloseIntent(adapter(), 1n, WALLET);
    expect(intent.quote.entryPrice).toBeLessThan(intent.quote.markPrice);
  });
});

describe("settleFromReceipt", () => {
  const openedLog = (tokenId: bigint, address: Address = VAULT) => ({
    address,
    topics: encodeEventTopics({
      abi: syntheticVaultAbi,
      eventName: "PositionOpened",
      args: {tokenId, owner: WALLET, feedId: FEED},
    }) as Hex[],
    // isLong, collateral, units, entryPrice, copiedFromId -- values do not matter to this path.
    data: ("0x" + "00".repeat(160)) as Hex,
  });

  const receipt = (over: Partial<Receipt> = {}): Receipt => ({
    status: "success",
    from: WALLET,
    to: VAULT,
    logs: [openedLog(7n)],
    ...over,
  });

  const settle = (r: Receipt | null) =>
    settleFromReceipt(adapter({getReceipt: async () => r}), "0xab" as Hex, {
      wallet: WALLET,
      action: "open",
    });

  it("reads the token id out of the event", async () => {
    expect((await settle(receipt())).tokenId).toBe(7n);
  });

  it("reports a transaction that has not been mined", async () => {
    await expect(settle(null)).rejects.toMatchObject({code: "NOT_FOUND"});
  });

  it("reports a reverted transaction", async () => {
    await expect(settle(receipt({status: "reverted"}))).rejects.toMatchObject({code: "CONFLICT"});
  });

  /// Nothing the client says is trusted. Someone could report a stranger's transaction hash and
  /// claim the position.
  it("refuses a transaction sent by a different wallet", async () => {
    await expect(settle(receipt({from: OTHER}))).rejects.toMatchObject({code: "FORBIDDEN"});
  });

  it("refuses a transaction that called something else", async () => {
    await expect(settle(receipt({to: OTHER}))).rejects.toMatchObject({code: "VALIDATION"});
  });

  it("refuses a transaction that emitted no position event", async () => {
    await expect(settle(receipt({logs: []}))).rejects.toMatchObject({code: "CONFLICT"});
  });

  it("ignores an event emitted by a different contract", async () => {
    await expect(settle(receipt({logs: [openedLog(7n, OTHER)]}))).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});
