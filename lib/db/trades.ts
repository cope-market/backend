import type {Pool} from "pg";

/// Trade intent records.
///
/// Written before the transaction is handed to the user, so a client that loses the response can
/// still recover what it started. Nothing here is trusted as a statement of what happened on-chain:
/// that comes from the receipt.

export type TradeAction = "open" | "close";
export type TradeStatus =
  "pending" | "submitted" | "confirmed" | "failed" | "cancelled" | "expired";

export interface Trade {
  id: string;
  userId: string;
  action: TradeAction;
  status: TradeStatus;
  feedId: string;
  isLong: boolean | null;
  collateral: bigint | null;
  tokenId: bigint | null;
  copiedFromTokenId: bigint | null;
  quote: unknown;
  tx: unknown;
  txHash: string | null;
  thesisId: string | null;
  error: string | null;
  expiresAt: Date;
  createdAt: Date;
  confirmedAt: Date | null;
}

interface TradeRow {
  id: string;
  user_id: string;
  action: TradeAction;
  status: TradeStatus;
  feed_id: string;
  is_long: boolean | null;
  collateral: string | null;
  token_id: string | null;
  copied_from_token_id: string | null;
  quote_json: unknown;
  tx_json: unknown;
  tx_hash: string | null;
  thesis_id: string | null;
  error: string | null;
  expires_at: Date;
  created_at: Date;
  confirmed_at: Date | null;
}

const COLUMNS = `id, user_id, action, status, feed_id, is_long, collateral, token_id,
  copied_from_token_id, quote_json, tx_json, tx_hash, thesis_id, error, expires_at,
  created_at, confirmed_at`;

// Numeric columns arrive as strings from pg, which is what keeps a uint256 exact.
const toBigInt = (value: string | null): bigint | null => (value === null ? null : BigInt(value));

function toTrade(row: TradeRow): Trade {
  return {
    id: row.id,
    userId: row.user_id,
    action: row.action,
    status: row.status,
    feedId: row.feed_id,
    isLong: row.is_long,
    collateral: toBigInt(row.collateral),
    tokenId: toBigInt(row.token_id),
    copiedFromTokenId: toBigInt(row.copied_from_token_id),
    quote: row.quote_json,
    tx: row.tx_json,
    txHash: row.tx_hash,
    thesisId: row.thesis_id,
    error: row.error,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
  };
}

export interface NewTrade {
  userId: string;
  action: TradeAction;
  feedId: string;
  isLong: boolean | null;
  collateral: bigint | null;
  tokenId: bigint | null;
  copiedFromTokenId: bigint | null;
  quote: unknown;
  tx: unknown;
  thesisId: string | null;
  expiresAt: Date;
}

export async function insertTrade(pool: Pool, trade: NewTrade): Promise<Trade> {
  const {rows} = await pool.query<TradeRow>(
    `insert into trades (user_id, action, feed_id, is_long, collateral, token_id,
                         copied_from_token_id, quote_json, tx_json, thesis_id, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     returning ${COLUMNS}`,
    [
      trade.userId,
      trade.action,
      trade.feedId,
      trade.isLong,
      trade.collateral?.toString() ?? null,
      trade.tokenId?.toString() ?? null,
      trade.copiedFromTokenId?.toString() ?? null,
      JSON.stringify(trade.quote),
      JSON.stringify(trade.tx),
      trade.thesisId,
      trade.expiresAt,
    ],
  );
  return toTrade(rows[0]!);
}

export async function findTrade(pool: Pool, id: string): Promise<Trade | null> {
  const {rows} = await pool.query<TradeRow>(`select ${COLUMNS} from trades where id = $1`, [id]);
  return rows[0] ? toTrade(rows[0]) : null;
}

/// Records the transaction the client says it sent. The unique constraint on tx_hash is what stops
/// the same fill being attributed to two intents.
export async function markSubmitted(pool: Pool, id: string, txHash: string): Promise<Trade | null> {
  const {rows} = await pool.query<TradeRow>(
    `update trades set status = 'submitted', tx_hash = $2
     where id = $1 and status in ('pending', 'submitted')
     returning ${COLUMNS}`,
    [id, txHash],
  );
  return rows[0] ? toTrade(rows[0]) : null;
}

export async function markConfirmed(
  pool: Pool,
  id: string,
  tokenId: bigint | null,
): Promise<Trade | null> {
  const {rows} = await pool.query<TradeRow>(
    `update trades set status = 'confirmed', token_id = $2, confirmed_at = now()
     where id = $1 returning ${COLUMNS}`,
    [id, tokenId?.toString() ?? null],
  );
  return rows[0] ? toTrade(rows[0]) : null;
}

export async function markFailed(pool: Pool, id: string, reason: string): Promise<Trade | null> {
  const {rows} = await pool.query<TradeRow>(
    `update trades set status = 'failed', error = $2 where id = $1 returning ${COLUMNS}`,
    [id, reason],
  );
  return rows[0] ? toTrade(rows[0]) : null;
}

/// Only a pending intent can be abandoned. Once a transaction is out there, cancelling the record
/// would hide a trade that is really happening.
export async function markCancelled(pool: Pool, id: string): Promise<Trade | null> {
  const {rows} = await pool.query<TradeRow>(
    `update trades set status = 'cancelled' where id = $1 and status = 'pending'
     returning ${COLUMNS}`,
    [id],
  );
  return rows[0] ? toTrade(rows[0]) : null;
}
