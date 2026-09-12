import type {z} from "zod";
import {ChainConfig} from "../api-schema/entities";
import {loadEnv} from "../env";

/// Chain and contract configuration, served so a client never hard-codes an address.
///
/// Everything here comes from the environment. Pointing at a different deployment is a config
/// change, not a code change, which is what makes the mainnet cutover a deploy rather than a patch.

const ARC_TESTNET = {
  chainId: 5042002,
  name: "Arc Testnet",
  rpcUrl: "https://rpc.testnet.arc.io",
  explorerUrl: "https://testnet.arcscan.app",
} as const;

export function chainConfig(): z.infer<typeof ChainConfig> {
  loadEnv();
  const env = process.env;

  return ChainConfig.parse({
    chainId: Number(env["ARC_CHAIN_ID"] ?? ARC_TESTNET.chainId),
    name: env["ARC_CHAIN_NAME"] ?? ARC_TESTNET.name,
    rpcUrl: env["ARC_RPC_URL"] ?? ARC_TESTNET.rpcUrl,
    explorerUrl: env["ARC_EXPLORER_URL"] ?? ARC_TESTNET.explorerUrl,
    nativeCurrency: {name: "USD Coin", symbol: "USDC", decimals: 18},
    // Arc rejects a transaction below this. Clients that build their own gas hints need it.
    minMaxFeePerGasWei: "20000000000",
    contracts: {
      syntheticVault: env["SYNTHETIC_VAULT_ADDRESS"] ?? "",
      liquidityVault: env["LIQUIDITY_VAULT_ADDRESS"] ?? "",
      usdc: env["USDC_ADDRESS"] ?? "",
      oracle: env["ORACLE_ADDRESS"] ?? "",
    },
    usdcDecimals: 6,
  });
}
