import type {z} from "zod";
import {Asset} from "../api-schema/entities";

/// The asset catalogue. A feed id is a bytes32 and nothing on-chain turns it into "EUR/USD", so the
/// mapping lives here.
///
/// Risk parameters and prices are deliberately absent: those come from SyntheticVault.assetConfig
/// and the oracle contract, which are the source of truth and can change without a deploy.
///
/// Limited to the feeds our Hermes key is entitled to. AAPL, SPY and NVDA return HTTP 403, and
/// listing them would put permanently broken markets in front of users.
const CATALOGUE = [
  {
    feedId: "0xa995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b",
    symbol: "EUR/USD",
    name: "Euro",
    assetClass: "fx",
    logoUrl: null,
  },
  {
    feedId: "0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2",
    symbol: "XAU/USD",
    name: "Gold",
    assetClass: "metal",
    logoUrl: null,
  },
  {
    feedId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    symbol: "BTC/USD",
    name: "Bitcoin",
    assetClass: "crypto",
    logoUrl: null,
  },
  {
    feedId: "0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
    symbol: "TSLA/USD",
    name: "Tesla",
    assetClass: "equity",
    logoUrl: null,
  },
] as const;

export function assetCatalogue(): z.infer<typeof Asset>[] {
  return CATALOGUE.map((asset) => Asset.parse(asset));
}

export function findAsset(feedId: string): z.infer<typeof Asset> | null {
  const match = CATALOGUE.find((asset) => asset.feedId.toLowerCase() === feedId.toLowerCase());
  return match ? Asset.parse(match) : null;
}
