import type {Pool} from "pg";
import {SubgraphError} from "../subgraph/client";
import type {SubgraphClient} from "../subgraph/client";
import {getSubgraphClient} from "../subgraph/client";
import {EMPTY_TOTALS, traderTotals} from "../subgraph/traders";

/// The follow graph, and the stats that depend on it.

export async function followUser(
  pool: Pool,
  followerId: string,
  followeeId: string,
): Promise<boolean> {
  if (followerId === followeeId) return false;
  await pool.query(
    `insert into follows (follower_id, followee_id) values ($1, $2) on conflict do nothing`,
    [followerId, followeeId],
  );
  return true;
}

export async function unfollowUser(
  pool: Pool,
  followerId: string,
  followeeId: string,
): Promise<void> {
  await pool.query(`delete from follows where follower_id = $1 and followee_id = $2`, [
    followerId,
    followeeId,
  ]);
}

export async function isFollowing(
  pool: Pool,
  followerId: string,
  followeeId: string,
): Promise<boolean> {
  const {rowCount} = await pool.query(
    `select 1 from follows where follower_id = $1 and followee_id = $2`,
    [followerId, followeeId],
  );
  return rowCount === 1;
}

export interface UserStats {
  openPositions: number;
  closedPositions: number;
  realizedPnlUsd: string;
  followers: number;
  following: number;
  copiesReceived: number;
}

/// Follows and copies come from our tables; positions and P&L come from the subgraph.
///
/// The split is not arbitrary. A follow exists only here. A position exists on chain whether or not
/// this service saw it opened, so counting confirmed trades undercounts anyone who went straight to
/// the contract.
///
/// If the subgraph is unreachable the profile still renders, with the figures this service can
/// derive on its own and a zero where the P&L would be. A profile is worth showing without its P&L;
/// it is not worth a 500. The leaderboard makes the opposite choice, deliberately — see below.
export async function userStats(
  pool: Pool,
  userId: string,
  walletAddress: string,
  subgraph: SubgraphClient = getSubgraphClient(),
): Promise<UserStats> {
  const {rows} = await pool.query<{
    followers: string;
    following: string;
    copies_received: string;
    opens: string;
    closes: string;
  }>(
    `select
       (select count(*) from follows where followee_id = $1)                        as followers,
       (select count(*) from follows where follower_id = $1)                        as following,
       (select coalesce(sum(copy_count), 0) from theses where user_id = $1)         as copies_received,
       (select count(*) from trades
         where user_id = $1 and action = 'open'  and status = 'confirmed')          as opens,
       (select count(*) from trades
         where user_id = $1 and action = 'close' and status = 'confirmed')          as closes`,
    [userId],
  );

  const row = rows[0]!;
  const social = {
    followers: Number(row.followers),
    following: Number(row.following),
    copiesReceived: Number(row.copies_received),
  };

  let totals = EMPTY_TOTALS;
  let onChain = true;
  try {
    totals =
      (await traderTotals(subgraph, [walletAddress])).get(walletAddress.toLowerCase()) ??
      EMPTY_TOTALS;
  } catch (error) {
    // A configuration mistake is not a degraded dependency, and hiding it behind zeros would mean
    // nobody noticed until a judge asked why every profile reads 0.
    if (!(error instanceof SubgraphError)) throw error;
    console.warn(
      `[userStats] subgraph unavailable, falling back to trade counts: ${error.message}`,
    );
    onChain = false;
  }

  if (onChain) {
    return {
      openPositions: totals.openPositions,
      closedPositions: totals.closedPositions,
      realizedPnlUsd: totals.realizedPnlWad,
      ...social,
    };
  }

  const opens = Number(row.opens);
  const closes = Number(row.closes);
  return {
    // A position is open until it has been closed. Clamped, because a close confirmed against a
    // position opened before this service existed would otherwise show a negative count.
    openPositions: Math.max(opens - closes, 0),
    closedPositions: closes,
    realizedPnlUsd: "0",
    ...social,
  };
}

export interface LeaderboardEntry {
  userId: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  walletAddress: string;
  realizedPnlUsd: string;
  closedPositions: number;
  winRate: number;
  copiesReceived: number;
}

const WINDOW_INTERVAL: Record<string, string> = {
  "7d": "7 days",
  "30d": "30 days",
  all: "100 years",
};

/// Ranked on what can actually be measured today: copies received, then positions closed.
///
/// Realised P&L is the column this should sort on and it comes from the subgraph. Sorting on a
/// column that is zero for everybody would produce an arbitrary order presented as a ranking, which
/// is worse than being honest about what is being measured.
export async function leaderboard(
  pool: Pool,
  window: "7d" | "30d" | "all",
  limit = 25,
): Promise<LeaderboardEntry[]> {
  const interval = WINDOW_INTERVAL[window] ?? WINDOW_INTERVAL["all"]!;

  const {rows} = await pool.query<{
    user_id: string;
    x_handle: string;
    x_name: string;
    x_avatar_url: string | null;
    wallet_address: string;
    closed_positions: string;
    copies_received: string;
  }>(
    `select u.id as user_id, u.x_handle, u.x_name, u.x_avatar_url, u.wallet_address,
            (select count(*) from trades tr
              where tr.user_id = u.id and tr.action = 'close' and tr.status = 'confirmed'
                and tr.confirmed_at > now() - $1::interval)                as closed_positions,
            (select coalesce(sum(th.copy_count), 0) from theses th
              where th.user_id = u.id and th.created_at > now() - $1::interval) as copies_received
     from users u
     order by copies_received desc, closed_positions desc, u.created_at asc
     limit $2`,
    [interval, limit],
  );

  return rows.map((row) => ({
    userId: row.user_id,
    handle: row.x_handle,
    name: row.x_name,
    avatarUrl: row.x_avatar_url,
    walletAddress: row.wallet_address,
    realizedPnlUsd: "0",
    closedPositions: Number(row.closed_positions),
    // Needs per-position P&L, which is the subgraph's job. Reported as zero rather than guessed.
    winRate: 0,
    copiesReceived: Number(row.copies_received),
  }));
}
