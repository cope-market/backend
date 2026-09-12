import {createPublicClient, defineChain, http} from "viem";
import type {Address, Hex, PublicClient} from "viem";
import {chainConfig} from "../config/chain";

/// Read-only chain access. This service never holds a key and never sends a transaction: it builds
/// unsigned calls and reads receipts. Signing belongs to the user's wallet.

export function arcChain() {
  const config = chainConfig();
  return defineChain({
    id: config.chainId,
    name: config.name,
    nativeCurrency: config.nativeCurrency,
    rpcUrls: {default: {http: [config.rpcUrl]}},
    blockExplorers: {default: {name: "Explorer", url: config.explorerUrl}},
  });
}

let client: PublicClient | undefined;

export function publicClient(): PublicClient {
  client ??= createPublicClient({chain: arcChain(), transport: http()}) as PublicClient;
  return client;
}

export interface ContractAddresses {
  syntheticVault: Address;
  liquidityVault: Address;
  usdc: Address;
  oracle: Address;
}

export function addresses(): ContractAddresses {
  const {contracts} = chainConfig();
  return {
    syntheticVault: contracts.syntheticVault as Address,
    liquidityVault: contracts.liquidityVault as Address,
    usdc: contracts.usdc as Address,
    oracle: contracts.oracle as Address,
  };
}

export type FeedId = Hex;
