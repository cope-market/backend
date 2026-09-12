import {z} from "zod";

/// Shared field types. Every amount crosses the wire as a decimal string and names its unit, so a
/// client never has to guess whether a number is 6-decimal USDC or an 18-decimal wad.

const HEX = (bytes: number) => new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`);

export const Address = z
  .string()
  .regex(HEX(20), "must be a 0x-prefixed 20-byte hex address")
  .describe("EVM address, 0x-prefixed, 20 bytes.");

export const FeedId = z
  .string()
  .regex(HEX(32), "must be a 0x-prefixed 32-byte hex feed id")
  .describe("Pyth price feed id, 0x-prefixed, 32 bytes. Identifies a market.");

export const TxHash = z
  .string()
  .regex(HEX(32), "must be a 0x-prefixed 32-byte hex hash")
  .describe("Transaction hash, 0x-prefixed, 32 bytes.");

export const HexData = z
  .string()
  .regex(/^0x([0-9a-fA-F]{2})*$/, "must be 0x-prefixed hex with whole bytes")
  .describe("ABI-encoded calldata, 0x-prefixed.");

/// Canonical so that equal amounts have equal strings: no sign, no decimal point, no leading zero.
/// "0" is the one permitted value that starts with a zero.
const UNSIGNED_INTEGER = /^(0|[1-9][0-9]*)$/;
const SIGNED_INTEGER = /^-?(0|[1-9][0-9]*)$/;

export const Amount6 = z
  .string()
  .regex(UNSIGNED_INTEGER, "must be a canonical non-negative integer string")
  .describe('USDC amount in base units, 6 decimals. "1998000" is 1.998 USDC.');

export const Wad = z
  .string()
  .regex(UNSIGNED_INTEGER, "must be a canonical non-negative integer string")
  .describe('Fixed-point value with 18 decimals. "1160000000000000000" is 1.16.');

export const SignedWad = z
  .string()
  .regex(SIGNED_INTEGER, "must be a canonical integer string, optionally negative")
  .describe("Signed fixed-point value with 18 decimals. Negative means the trader is down.");

export const Bps = z.number().int().min(0).max(10_000).describe("Basis points. 10 is 0.10%.");

export const XHandle = z
  .string()
  .regex(/^[A-Za-z0-9_]{1,15}$/, "must be an X handle without the leading at sign")
  .describe("X handle, without the leading at sign.");

export const IsoDateTime = z.iso.datetime().describe("ISO-8601 instant in UTC.");

export const Cursor = z
  .string()
  .min(1)
  .describe("Opaque pagination cursor. Pass it back unchanged; do not parse it.");

/// Closed on purpose. Clients switch on these, and an open set cannot be handled exhaustively.
export const ErrorCode = z.enum([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL",
  "PRICE_STALE",
  "PRICE_UNAVAILABLE",
  "ASSET_DISABLED",
  "CONFIDENCE_TOO_WIDE",
  "POSITION_CAP_EXCEEDED",
  "OPEN_INTEREST_CAP_EXCEEDED",
  "INSUFFICIENT_LIQUIDITY",
  "INSUFFICIENT_BALANCE",
  "QUOTE_EXPIRED",
  "GEO_BLOCKED",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z
  .object({
    error: z.object({
      code: ErrorCode,
      message: z.string().describe("Human-readable. Do not switch on this; switch on code."),
    }),
  })
  .describe("Every non-2xx response has this shape.");

/// One page of rows. nextCursor is required and nullable: null says "this is the last page", where
/// an absent field would say "unknown".
export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    nextCursor: Cursor.nullable(),
  });
}
