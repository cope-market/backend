import type {Pool} from "pg";
import {THESIS_COLUMNS, THESIS_FROM, THESIS_SELECT, toThesis, type Thesis} from "./theses";

/// The ranked feed.
///
/// Ranking happens in SQL. Fetching every row and scoring it in TypeScript stops working at the
/// first thousand rows, and cursor pagination over an application-sorted list cannot be made
/// stable.

export type FeedTab = "latest" | "top" | "following";

/// Engagement over age. Copies weigh most because copying is the strongest signal the product has:
/// somebody put money behind the take. Comments beat likes for the same reason at lower cost.
///
/// The exponent on age decides how fast yesterday's post falls behind today's. 1.4 is steep enough
/// that a day-old post needs roughly three times the engagement to hold its place.
///
/// Realised P&L belongs in the numerator and comes from the subgraph. The expression is written so
/// that term can be added without reshaping the query.
const SCORE = `
  (1 + t.like_count + 3 * t.copy_count + 2 * t.comment_count)
  / power(extract(epoch from ($4::timestamptz - t.created_at)) / 3600.0 + 2, 1.4)`;

export interface FeedPage {
  theses: Thesis[];
  nextCursor: string | null;
}

interface Cursor {
  /// Fixed at the first page so the ranking does not shift underneath a reader as time passes.
  at: string;
  score?: number;
  createdAt?: string;
  id: string;
}

const encode = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString("base64url");

export function decodeFeedCursor(cursor: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Cursor;
    if (!parsed.id || !parsed.at) throw new Error("incomplete");
    return parsed;
  } catch {
    throw new Error("Malformed cursor.");
  }
}

export async function getFeed(
  pool: Pool,
  options: {tab: FeedTab; viewerId: string | null; limit: number; cursor: string | null},
): Promise<FeedPage> {
  const cursor = options.cursor ? decodeFeedCursor(options.cursor) : null;
  // The reference time is pinned on the first page and carried in the cursor. Without it, "top"
  // re-scores between pages and a reader sees rows twice or not at all.
  const at = cursor?.at ?? new Date().toISOString();
  const fetch = options.limit + 1;

  if (options.tab === "following") {
    if (!options.viewerId) return {theses: [], nextCursor: null};

    const {rows} = await pool.query(
      `${THESIS_SELECT}
       where t.user_id in (select followee_id from follows where follower_id = $1::uuid)
         and ($2::timestamptz is null or (t.created_at, t.id) < ($2::timestamptz, $3::uuid))
       order by t.created_at desc, t.id desc
       limit $4`,
      [options.viewerId, cursor?.createdAt ?? null, cursor?.id ?? null, fetch],
    );
    return chronological(rows, options.limit, at);
  }

  if (options.tab === "latest") {
    const {rows} = await pool.query(
      `${THESIS_SELECT}
       where ($2::timestamptz is null or (t.created_at, t.id) < ($2::timestamptz, $3::uuid))
       order by t.created_at desc, t.id desc
       limit $4`,
      [options.viewerId, cursor?.createdAt ?? null, cursor?.id ?? null, fetch],
    );
    return chronological(rows, options.limit, at);
  }

  const {rows} = await pool.query(
    `select * from (
       select ${SCORE} as score, ${THESIS_COLUMNS} ${THESIS_FROM}
     ) ranked
     where ($2::numeric is null or (ranked.score, ranked.id) < ($2::numeric, $3::uuid))
     order by ranked.score desc, ranked.id desc
     limit $5`,
    [options.viewerId, cursor?.score ?? null, cursor?.id ?? null, at, fetch],
  );

  const hasMore = rows.length > options.limit;
  const visible = hasMore ? rows.slice(0, options.limit) : rows;
  const last = visible[visible.length - 1];

  return {
    theses: visible.map(toThesis),
    nextCursor:
      hasMore && last ? encode({at, score: Number(last.score), id: last.id as string}) : null,
  };
}

function chronological(rows: Array<Record<string, unknown>>, limit: number, at: string): FeedPage {
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const last = visible[visible.length - 1];

  return {
    theses: visible.map((row) => toThesis(row as never)),
    nextCursor:
      hasMore && last
        ? encode({
            at,
            createdAt: (last["created_at"] as Date).toISOString(),
            id: last["id"] as string,
          })
        : null,
  };
}
