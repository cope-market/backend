import {parseAbi} from "viem";

/// Only the surface this service uses. Written out rather than generated, so a reader can see
/// exactly what the backend touches and a contract change that matters shows up as a diff here.

export const syntheticVaultAbi = parseAbi([
  "function assetConfig(bytes32 feedId) view returns (bool enabled, uint32 maxAgeSec, uint32 maxConfBps, uint32 openFeeBps, uint32 closeFeeBps, uint128 maxOiUsd, uint128 maxPositionUsd)",
  "function enabledFeeds() view returns (bytes32[])",
  "function openInterest(bytes32 feedId, bool isLong) view returns (uint256)",
  "function liability(bytes32 feedId) view returns (int256)",
  "function authorFeeBps() view returns (uint16)",
  "function nextTokenId() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function positions(uint256 tokenId) view returns ((bytes32 feedId, bool isLong, uint64 openedAt, uint128 collateral, uint256 units, uint256 entryPrice, address author, uint256 copiedFromId, address copyAuthor, uint16 authorFeeBps))",
  "function open(bytes32 feedId, bool isLong, uint128 collateral, uint256 copiedFromId, bytes[] updateData) payable returns (uint256 tokenId)",
  "function close(uint256 tokenId, bytes[] updateData) payable",
  "event PositionOpened(uint256 indexed tokenId, address indexed owner, bytes32 indexed feedId, bool isLong, uint128 collateral, uint256 units, uint256 entryPrice, uint256 copiedFromId)",
  "event PositionClosed(uint256 indexed tokenId, address indexed closedBy, bytes32 indexed feedId, uint256 exitPrice, int256 pnlWad, uint256 payout)",
]);

export const priceOracleAbi = parseAbi([
  "function getPrice(bytes32 feedId, uint256 maxAge) view returns ((uint256 price, uint256 conf, uint64 publishTime))",
  "function lastPublishTime(bytes32 feedId) view returns (uint64)",
]);

export const liquidityVaultAbi = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function exitFeeBps() view returns (uint16)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);
