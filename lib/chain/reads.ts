import type {Address, Hex} from "viem";
import {erc20Abi, liquidityVaultAbi, priceOracleAbi, syntheticVaultAbi} from "./abi";
import {addresses, publicClient} from "./client";

/// Typed reads of contract state. Everything the API needs to validate a trade before a user signs
/// it comes from here rather than from a cached copy, because the contract can change its own
/// parameters without telling us.

export interface AssetConfig {
  enabled: boolean;
  maxAgeSec: number;
  maxConfBps: number;
  openFeeBps: number;
  closeFeeBps: number;
  maxOiUsd: bigint;
  maxPositionUsd: bigint;
}

export interface OraclePrice {
  price: bigint;
  conf: bigint;
  publishTime: number;
}

export interface Position {
  feedId: Hex;
  isLong: boolean;
  openedAt: number;
  collateral: bigint;
  units: bigint;
  entryPrice: bigint;
  author: Address;
  copiedFromId: bigint;
  copyAuthor: Address;
  authorFeeBps: number;
}

export async function readAssetConfig(feedId: Hex): Promise<AssetConfig> {
  const [enabled, maxAgeSec, maxConfBps, openFeeBps, closeFeeBps, maxOiUsd, maxPositionUsd] =
    await publicClient().readContract({
      address: addresses().syntheticVault,
      abi: syntheticVaultAbi,
      functionName: "assetConfig",
      args: [feedId],
    });

  return {enabled, maxAgeSec, maxConfBps, openFeeBps, closeFeeBps, maxOiUsd, maxPositionUsd};
}

/// Read with no staleness bound, so a caller can decide what to do about an old price rather than
/// having the call revert underneath them. Freshness is checked explicitly where it matters.
export async function readPrice(
  feedId: Hex,
  maxAgeSec = Number.MAX_SAFE_INTEGER,
): Promise<OraclePrice> {
  const result = await publicClient().readContract({
    address: addresses().oracle,
    abi: priceOracleAbi,
    functionName: "getPrice",
    args: [feedId, BigInt(maxAgeSec)],
  });
  return {price: result.price, conf: result.conf, publishTime: Number(result.publishTime)};
}

export async function readLastPublishTime(feedId: Hex): Promise<number> {
  const value = await publicClient().readContract({
    address: addresses().oracle,
    abi: priceOracleAbi,
    functionName: "lastPublishTime",
    args: [feedId],
  });
  return Number(value);
}

export async function readOpenInterest(feedId: Hex, isLong: boolean): Promise<bigint> {
  return publicClient().readContract({
    address: addresses().syntheticVault,
    abi: syntheticVaultAbi,
    functionName: "openInterest",
    args: [feedId, isLong],
  });
}

export async function readPosition(tokenId: bigint): Promise<Position> {
  const p = await publicClient().readContract({
    address: addresses().syntheticVault,
    abi: syntheticVaultAbi,
    functionName: "positions",
    args: [tokenId],
  });
  return {
    feedId: p.feedId,
    isLong: p.isLong,
    openedAt: Number(p.openedAt),
    collateral: p.collateral,
    units: p.units,
    entryPrice: p.entryPrice,
    author: p.author,
    copiedFromId: p.copiedFromId,
    copyAuthor: p.copyAuthor,
    authorFeeBps: p.authorFeeBps,
  };
}

export async function readPositionOwner(tokenId: bigint): Promise<Address> {
  return publicClient().readContract({
    address: addresses().syntheticVault,
    abi: syntheticVaultAbi,
    functionName: "ownerOf",
    args: [tokenId],
  });
}

export async function readLiquidityAvailable(): Promise<bigint> {
  return publicClient().readContract({
    address: addresses().liquidityVault,
    abi: liquidityVaultAbi,
    functionName: "totalAssets",
  });
}

export async function readUsdcBalance(owner: Address): Promise<bigint> {
  return publicClient().readContract({
    address: addresses().usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
}

export async function readUsdcAllowance(owner: Address, spender: Address): Promise<bigint> {
  return publicClient().readContract({
    address: addresses().usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  });
}
