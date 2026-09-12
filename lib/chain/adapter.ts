import type {Address, Hex} from "viem";
import {syntheticVaultAbi} from "./abi";
import {addresses, publicClient} from "./client";
import {
  readAssetConfig,
  readLiquidityAvailable,
  readOpenInterest,
  readPosition,
  readPositionOwner,
  readPrice,
  readUsdcBalance,
} from "./reads";
import type {ChainAdapter, Receipt} from "../trading/service";

/// The real ChainAdapter. Everything here is a read or a simulation; this service never signs.
export function chainAdapter(): ChainAdapter {
  const vaultAddress = addresses().syntheticVault;

  return {
    vaultAddress,
    readAssetConfig,
    readPrice: (feedId) => readPrice(feedId),
    readOpenInterest,
    readLiquidityAvailable,
    readUsdcBalance,
    readPosition,
    readPositionOwner,

    // eth_call from the user's address. A revert surfaces here, before they pay gas for it.
    simulate: async (from: Address, data: Hex) => {
      await publicClient().call({account: from, to: vaultAddress, data});
    },

    getReceipt: async (txHash: Hex): Promise<Receipt | null> => {
      const receipt = await publicClient()
        .getTransactionReceipt({hash: txHash})
        .catch(() => null);
      if (!receipt) return null;

      return {
        status: receipt.status,
        from: receipt.from,
        to: receipt.to,
        logs: receipt.logs.map((log) => ({
          address: log.address,
          topics: log.topics as Hex[],
          data: log.data,
        })),
      };
    },

    now: () => Math.floor(Date.now() / 1000),
  };
}

export {syntheticVaultAbi};
