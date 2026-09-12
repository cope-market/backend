import {decodeEventLog, encodeFunctionData} from "viem";
import type {Address, Hex} from "viem";
import {syntheticVaultAbi} from "../chain/abi";
import type {AssetConfig, OraclePrice, Position} from "../chain/reads";
import {ApiException} from "../api-server/handler";
import {quoteOpen} from "./quote";
import {TradeRejected, validateOpen} from "./validate";
import type {ChainState} from "./validate";

/// Builds the transactions a user signs, and interprets the receipts that come back.
///
/// Chain access is behind an interface so the whole flow can be tested without a network. The real
/// adapter wraps viem; the tests supply a fake.

export const QUOTE_TTL_SECONDS = 30;

export interface Receipt {
  status: "success" | "reverted";
  from: Address;
  to: Address | null;
  logs: Array<{address: Address; topics: Hex[]; data: Hex}>;
}

export interface ChainAdapter {
  vaultAddress: Address;
  readAssetConfig: (feedId: Hex) => Promise<AssetConfig>;
  readPrice: (feedId: Hex) => Promise<OraclePrice>;
  readOpenInterest: (feedId: Hex, isLong: boolean) => Promise<bigint>;
  readLiquidityAvailable: () => Promise<bigint>;
  readUsdcBalance: (owner: Address) => Promise<bigint>;
  readPosition: (tokenId: bigint) => Promise<Position>;
  readPositionOwner: (tokenId: bigint) => Promise<Address>;
  /// Runs the call without sending it. A revert here means the user would have paid gas to fail.
  simulate: (from: Address, data: Hex) => Promise<void>;
  getReceipt: (txHash: Hex) => Promise<Receipt | null>;
  now: () => number;
}

export interface OpenIntentInput {
  feedId: Hex;
  isLong: boolean;
  collateral: bigint;
  wallet: Address;
  copiedFromTokenId: bigint | null;
}

export interface BuiltIntent {
  quote: {
    collateral: bigint;
    netCollateral: bigint;
    openFee: bigint;
    openFeeBps: number;
    markPrice: bigint;
    entryPrice: bigint;
    units: bigint;
  };
  tx: {to: Address; data: Hex; value: string};
  expiresAt: Date;
}

async function gatherState(
  chain: ChainAdapter,
  feedId: Hex,
  isLong: boolean,
  wallet: Address,
): Promise<ChainState> {
  const [config, price, openInterest, liquidityAvailable, usdcBalance] = await Promise.all([
    chain.readAssetConfig(feedId),
    chain.readPrice(feedId),
    chain.readOpenInterest(feedId, isLong),
    chain.readLiquidityAvailable(),
    chain.readUsdcBalance(wallet),
  ]);
  return {config, price, openInterest, liquidityAvailable, usdcBalance, nowSeconds: chain.now()};
}

function rethrow(error: unknown): never {
  if (error instanceof TradeRejected) throw new ApiException(error.code, error.message);
  throw error;
}

export async function buildOpenIntent(
  chain: ChainAdapter,
  input: OpenIntentInput,
): Promise<BuiltIntent> {
  const state = await gatherState(chain, input.feedId, input.isLong, input.wallet);

  try {
    validateOpen({collateral: input.collateral, isLong: input.isLong}, state);
  } catch (error) {
    rethrow(error);
  }

  const quote = quoteOpen({
    price: state.price.price,
    conf: state.price.conf,
    collateral: input.collateral,
    openFeeBps: state.config.openFeeBps,
    isLong: input.isLong,
  });

  const data = encodeFunctionData({
    abi: syntheticVaultAbi,
    functionName: "open",
    // updateData is empty because the oracle is a push oracle today. When Pyth's pull path works on
    // Arc this is where the signed price blob goes, and the shape does not change.
    args: [input.feedId, input.isLong, input.collateral, input.copiedFromTokenId ?? 0n, []],
  });

  // The contract is the authority. Everything above is so the user gets a reason rather than a
  // revert; this is what proves the call would actually succeed.
  await chain.simulate(input.wallet, data);

  return {
    quote: {
      collateral: input.collateral,
      netCollateral: quote.netCollateral,
      openFee: quote.openFee,
      openFeeBps: state.config.openFeeBps,
      markPrice: state.price.price,
      entryPrice: quote.entryPrice,
      units: quote.units,
    },
    tx: {to: chain.vaultAddress, data, value: "0"},
    expiresAt: new Date((chain.now() + QUOTE_TTL_SECONDS) * 1000),
  };
}

export async function buildCloseIntent(
  chain: ChainAdapter,
  tokenId: bigint,
  wallet: Address,
): Promise<BuiltIntent> {
  const owner = await chain.readPositionOwner(tokenId).catch(() => null);
  if (!owner) throw new ApiException("NOT_FOUND", "That position does not exist, or is closed.");
  if (owner.toLowerCase() !== wallet.toLowerCase()) {
    throw new ApiException("FORBIDDEN", "That position belongs to somebody else.");
  }

  const position = await chain.readPosition(tokenId);
  const [config, price] = await Promise.all([
    chain.readAssetConfig(position.feedId),
    chain.readPrice(position.feedId),
  ]);

  // Closing is blocked by a stale price the same way opening is, and out of hours that is the
  // common case. Saying so is the difference between a user waiting and a user filing a bug.
  const age = chain.now() - price.publishTime;
  if (age > config.maxAgeSec) {
    throw new ApiException(
      "PRICE_STALE",
      `This market's price is ${age} seconds old and the limit is ${config.maxAgeSec}. ` +
        "The market is most likely closed; the position can be closed when it reopens.",
    );
  }

  const data = encodeFunctionData({
    abi: syntheticVaultAbi,
    functionName: "close",
    args: [tokenId, []],
  });
  await chain.simulate(wallet, data);

  const exitPrice = position.isLong ? price.price - price.conf : price.price + price.conf;

  return {
    quote: {
      collateral: position.collateral,
      netCollateral: position.collateral,
      openFee: 0n,
      openFeeBps: 0,
      markPrice: price.price,
      entryPrice: exitPrice,
      units: position.units,
    },
    tx: {to: chain.vaultAddress, data, value: "0"},
    expiresAt: new Date((chain.now() + QUOTE_TTL_SECONDS) * 1000),
  };
}

export interface SettledTrade {
  tokenId: bigint | null;
}

/// Reads what actually happened. The client reports a transaction hash and nothing else is taken on
/// trust: the sender, the target contract and the event all come from the receipt.
export async function settleFromReceipt(
  chain: ChainAdapter,
  txHash: Hex,
  expected: {wallet: Address; action: "open" | "close"},
): Promise<SettledTrade> {
  const receipt = await chain.getReceipt(txHash);
  if (!receipt) throw new ApiException("NOT_FOUND", "That transaction has not been mined yet.");

  if (receipt.status === "reverted") {
    throw new ApiException("CONFLICT", "That transaction reverted on-chain.");
  }
  if (receipt.from.toLowerCase() !== expected.wallet.toLowerCase()) {
    throw new ApiException("FORBIDDEN", "That transaction was sent by a different wallet.");
  }
  if (receipt.to?.toLowerCase() !== chain.vaultAddress.toLowerCase()) {
    throw new ApiException("VALIDATION", "That transaction did not call the vault.");
  }

  // Decoded against the ABI rather than by reading a topic by position, so an event signature
  // change becomes a decode failure here instead of a silently wrong token id.
  const eventName = expected.action === "open" ? "PositionOpened" : "PositionClosed";

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== chain.vaultAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: syntheticVaultAbi,
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      });
      if (decoded.eventName === eventName) {
        return {tokenId: (decoded.args as {tokenId: bigint}).tokenId};
      }
    } catch {
      // Some other event from the same contract. Keep looking.
    }
  }

  throw new ApiException(
    "CONFLICT",
    `That transaction did not emit ${eventName}, so nothing was ${expected.action}ed.`,
  );
}
