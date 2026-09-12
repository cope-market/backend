import {createWalletClient, createPublicClient, http, type Address, type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {arcChain, addresses} from "../lib/chain/client";
import {erc20Abi} from "../lib/chain/abi";
import {createApiClient} from "../lib/api-client/client";
import {getPool, closePool} from "../lib/db/pool";
import {upsertUser} from "../lib/db/users";
import {loadEnv, requireEnv} from "../lib/env";
import {assetCatalogue} from "../lib/config/assets";

/// Opens and closes a real position on Arc testnet through the running API.
///
/// This is the step that proves the whole path: quote, validation, simulation, an unsigned
/// transaction the user's wallet actually signs, receipt verification, and the database agreeing
/// with the chain afterwards. USDC writes cannot be simulated in a fork on Arc, so there is no
/// substitute for doing it for real.
///
///   ALLOW_TEST_TOKENS=1 npm run verify:trade
loadEnv();

const PORT = process.env["VERIFY_PORT"] ?? "4400";
const PRIVY_ID = "did:privy:verification-runner";
const account = privateKeyToAccount(requireEnv("PRIVATE_KEY") as Hex);

const wallet = createWalletClient({account, chain: arcChain(), transport: http()});
const chainReader = createPublicClient({chain: arcChain(), transport: http()});
const api = createApiClient({
  baseUrl: `http://localhost:${PORT}/api/v1`,
  getAccessToken: async () => `test:${PRIVY_ID}`,
});

const log = (...parts: unknown[]) => console.log(...parts);

// The API authenticates by Privy identity, so the runner needs a row whose wallet is the key that
// will sign. Created directly because there is no browser here to complete a Privy sign-in.
await upsertUser(getPool(), {
  privyId: PRIVY_ID,
  xHandle: "verification_runner",
  xName: "Verification Runner",
  xAvatarUrl: null,
  walletAddress: account.address,
});
log("runner wallet", account.address);

const usdc = await chainReader.readContract({
  address: addresses().usdc,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [account.address as Address],
});
log("usdc balance", usdc.toString());

// BTC is the only feed that publishes around the clock; the others are closed outside market hours.
const btc = assetCatalogue().find((asset) => asset.symbol === "BTC/USD")!;

const {intent} = await api.createTradeIntent({
  body: {
    feedId: btc.feedId,
    isLong: true,
    collateral: "2000000",
    thesisId: null,
    copiedFromTokenId: null,
  },
});
log("intent", intent.tradeId, "entry", intent.quote.entryPrice, "units", intent.quote.units);

const openHash = await wallet.sendTransaction({
  to: intent.tx.to as Address,
  data: intent.tx.data as Hex,
  value: 0n,
});
await chainReader.waitForTransactionReceipt({hash: openHash});
log("opened", openHash);

const {trade} = await api.confirmTrade({
  params: {tradeId: intent.tradeId},
  body: {txHash: openHash},
});
log("confirmed", trade.status, "tokenId", trade.tokenId);
if (trade.status !== "confirmed" || !trade.tokenId) throw new Error("open did not confirm");

const {intent: closeIntent} = await api.createCloseIntent({
  params: {tokenId: trade.tokenId},
  body: {},
});
const closeHash = await wallet.sendTransaction({
  to: closeIntent.tx.to as Address,
  data: closeIntent.tx.data as Hex,
  value: 0n,
});
await chainReader.waitForTransactionReceipt({hash: closeHash});

const {trade: closed} = await api.confirmTrade({
  params: {tradeId: closeIntent.tradeId},
  body: {txHash: closeHash},
});
log("closed", closed.status, closeHash);
if (closed.status !== "confirmed") throw new Error("close did not confirm");

const after = await chainReader.readContract({
  address: addresses().usdc,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [account.address as Address],
});
log("usdc after", after.toString(), "delta", (after - usdc).toString());
log("VERIFIED: opened and closed a real position through the API");

await closePool();
