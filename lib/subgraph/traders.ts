import {z} from "zod";
import type {SubgraphClient} from "./client";

/// Trader figures from the Cope Market subgraph.
///
/// Addresses go in and come out lower-case. graph-node accepts either form on the way in, but every
/// address in a response is lower-case, so a map keyed on a checksummed address silently misses
/// every row.

export function normaliseAddress(address: string): string {
  return address.toLowerCase();
}

export interface TraderTotals {
  /// 1e18, signed, as a decimal string.
  realizedPnlWad: string;
  openPositions: number;
  closedPositions: number;
  wins: number;
  losses: number;
  copiesReceived: number;
  /// USDC, 6 decimals, as a decimal string.
  authorFeesEarned: string;
}

export const EMPTY_TOTALS: TraderTotals = {
  realizedPnlWad: "0",
  openPositions: 0,
  closedPositions: 0,
  wins: 0,
  losses: 0,
  copiesReceived: 0,
  authorFeesEarned: "0",
};

const TraderRow = z.object({
  id: z.string(),
  positionsOpened: z.number().int(),
  positionsClosed: z.number().int(),
  realizedPnlWad: z.string(),
  wins: z.number().int(),
  losses: z.number().int(),
  copiesReceived: z.number().int(),
  authorFeesEarned: z.string(),
});

const TradersResponse = z.object({traders: z.array(TraderRow)});

const TRADERS_QUERY = `
  query Traders($ids: [ID!]!, $first: Int!) {
    traders(where: {id_in: $ids}, first: $first) {
      id
      positionsOpened
      positionsClosed
      realizedPnlWad
      wins
      losses
      copiesReceived
      authorFeesEarned
    }
  }
`;

/// Lifetime totals for a set of addresses, keyed lower-case.
///
/// An address that has never traded has no `Trader` row at all, so it is simply absent from the
/// result rather than present with zeros. Callers fall back to `EMPTY_TOTALS`, which is the honest
/// reading: nothing happened, rather than something failed.
export async function traderTotals(
  client: SubgraphClient,
  addresses: string[],
): Promise<Map<string, TraderTotals>> {
  const totals = new Map<string, TraderTotals>();
  const ids = [...new Set(addresses.map(normaliseAddress))];
  if (ids.length === 0) return totals;

  const data = TradersResponse.parse(await client.query(TRADERS_QUERY, {ids, first: ids.length}));

  for (const row of data.traders) {
    totals.set(normaliseAddress(row.id), {
      realizedPnlWad: row.realizedPnlWad,
      // The subgraph counts opens and closes; what is still open is the difference. Clamped
      // because a position closed by someone who bought the NFT is counted against its author,
      // and nothing guarantees the two arrive in order across a reorg.
      openPositions: Math.max(row.positionsOpened - row.positionsClosed, 0),
      closedPositions: row.positionsClosed,
      wins: row.wins,
      losses: row.losses,
      copiesReceived: row.copiesReceived,
      authorFeesEarned: row.authorFeesEarned,
    });
  }

  return totals;
}

export interface WindowedTotals {
  realizedPnlWad: string;
  closedPositions: number;
  wins: number;
  losses: number;
}

const PositionRow = z.object({
  id: z.string(),
  author: z.object({id: z.string()}),
  realizedPnlWad: z.string().nullable(),
});

const PositionsResponse = z.object({positions: z.array(PositionRow)});

const CLOSED_POSITIONS_QUERY = `
  query ClosedPositions($authors: [String!]!, $since: BigInt!, $after: ID!, $first: Int!) {
    positions(
      where: {author_in: $authors, status_not: OPEN, closedAt_gte: $since, id_gt: $after}
      orderBy: id
      orderDirection: asc
      first: $first
    ) {
      id
      author { id }
      realizedPnlWad
    }
  }
`;

const PAGE_SIZE = 1000;
/// A stop, not a limit anyone is expected to reach. Without it a bug in the cursor turns into an
/// endless loop against a live indexer rather than a wrong answer.
const MAX_PAGES = 50;

/// Realised P&L over a window, aggregated per author.
///
/// `Trader` carries lifetime totals only, so a seven-day board cannot read them: it has to sum the
/// positions that closed inside the window. Running every window through this one path, `all`
/// included, means there is no second implementation to disagree with the first.
export async function windowedTotals(
  client: SubgraphClient,
  addresses: string[],
  sinceUnixSeconds: number,
): Promise<Map<string, WindowedTotals>> {
  const totals = new Map<string, WindowedTotals>();
  const authors = [...new Set(addresses.map(normaliseAddress))];
  if (authors.length === 0) return totals;

  // Cursor on id rather than skip. graph-node caps `skip` at 5000, and a board that silently
  // stopped counting past that point would look right and rank wrong.
  let after = "0x";
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = PositionsResponse.parse(
      await client.query(CLOSED_POSITIONS_QUERY, {
        authors,
        since: String(sinceUnixSeconds),
        after,
        first: PAGE_SIZE,
      }),
    );

    for (const row of data.positions) {
      const author = normaliseAddress(row.author.id);
      const current = totals.get(author) ?? {
        realizedPnlWad: "0",
        closedPositions: 0,
        wins: 0,
        losses: 0,
      };
      // A closed position always carries a P&L. Treating a null as zero rather than as a win keeps
      // a malformed row from inventing a ranking.
      const pnl = BigInt(row.realizedPnlWad ?? "0");
      totals.set(author, {
        realizedPnlWad: (BigInt(current.realizedPnlWad) + pnl).toString(),
        closedPositions: current.closedPositions + 1,
        // Strictly positive, so `wins + losses` always equals `closedPositions` and a flat close
        // never flatters a win rate.
        wins: current.wins + (pnl > 0n ? 1 : 0),
        losses: current.losses + (pnl > 0n ? 0 : 1),
      });
    }

    if (data.positions.length < PAGE_SIZE) break;
    after = data.positions[data.positions.length - 1]!.id;
  }

  return totals;
}

export function winRateOf(wins: number, losses: number): number {
  const decided = wins + losses;
  // Nobody with no closed positions has a win rate. Zero is the only answer that does not claim
  // something about a trader who has not finished a trade.
  return decided === 0 ? 0 : wins / decided;
}
