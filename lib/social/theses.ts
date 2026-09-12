import type {Pool, PoolClient} from "pg";

/// Theses and the interactions around them.
///
/// Counters are kept alongside the action that changes them, inside one transaction, so a feed
/// query never counts rows per thesis. Every counter update is written so that repeating the action
/// is a no-op rather than an increment.

export interface ThesisAuthor {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  walletAddress: string;
}

export interface ThesisEvent {
  tweetUrl: string;
  authorHandle: string;
  authorName: string;
  html: string;
  fetchedAt: Date;
}

export interface Thesis {
  id: string;
  author: ThesisAuthor;
  event: ThesisEvent | null;
  feedId: string;
  stance: "bullish" | "bearish";
  title: string;
  body: string;
  tokenId: bigint | null;
  copiedFromThesisId: string | null;
  likeCount: number;
  commentCount: number;
  copyCount: number;
  createdAt: Date;
  viewerHasLiked: boolean | null;
}

interface ThesisRow {
  id: string;
  feed_id: string;
  stance: "bullish" | "bearish";
  title: string;
  body: string;
  token_id: string | null;
  copied_from_thesis_id: string | null;
  like_count: number;
  comment_count: number;
  copy_count: number;
  created_at: Date;
  author_id: string;
  x_handle: string;
  x_name: string;
  x_avatar_url: string | null;
  wallet_address: string;
  tweet_url: string | null;
  event_author_handle: string | null;
  event_author_name: string | null;
  oembed_html: string | null;
  event_fetched_at: Date | null;
  viewer_has_liked: boolean | null;
}

/// One projection used by every read, so a thesis looks the same in the feed, on its own page and
/// on a profile.
export const THESIS_SELECT = `
  select t.id, t.feed_id, t.stance, t.title, t.body, t.token_id, t.copied_from_thesis_id,
         t.like_count, t.comment_count, t.copy_count, t.created_at,
         u.id as author_id, u.x_handle, u.x_name, u.x_avatar_url, u.wallet_address,
         e.tweet_url, e.author_handle as event_author_handle, e.author_name as event_author_name,
         e.oembed_html, e.fetched_at as event_fetched_at,
         case when $1::uuid is null then null
              else exists (select 1 from likes l where l.thesis_id = t.id and l.user_id = $1::uuid)
         end as viewer_has_liked
  from theses t
  join users u on u.id = t.user_id
  left join events e on e.id = t.event_id`;

export function toThesis(row: ThesisRow): Thesis {
  return {
    id: row.id,
    author: {
      id: row.author_id,
      handle: row.x_handle,
      name: row.x_name,
      avatarUrl: row.x_avatar_url,
      walletAddress: row.wallet_address,
    },
    event: row.tweet_url
      ? {
          tweetUrl: row.tweet_url,
          authorHandle: row.event_author_handle!,
          authorName: row.event_author_name!,
          html: row.oembed_html!,
          fetchedAt: row.event_fetched_at!,
        }
      : null,
    feedId: row.feed_id,
    stance: row.stance,
    title: row.title,
    body: row.body,
    tokenId: row.token_id === null ? null : BigInt(row.token_id),
    copiedFromThesisId: row.copied_from_thesis_id,
    likeCount: row.like_count,
    commentCount: row.comment_count,
    copyCount: row.copy_count,
    createdAt: row.created_at,
    viewerHasLiked: row.viewer_has_liked,
  };
}

export interface NewThesis {
  userId: string;
  eventId: string | null;
  feedId: string;
  stance: "bullish" | "bearish";
  title: string;
  body: string;
  copiedFromThesisId: string | null;
}

/// Creating a copy bumps the original's counter in the same transaction, so the number on screen
/// cannot disagree with the number of rows pointing at it.
export async function createThesis(pool: Pool, input: NewThesis): Promise<Thesis> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("begin");

    const {rows} = await client.query<{id: string}>(
      `insert into theses (user_id, event_id, feed_id, stance, title, body, copied_from_thesis_id)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [
        input.userId,
        input.eventId,
        input.feedId,
        input.stance,
        input.title,
        input.body,
        input.copiedFromThesisId,
      ],
    );

    if (input.copiedFromThesisId) {
      await client.query(`update theses set copy_count = copy_count + 1 where id = $1`, [
        input.copiedFromThesisId,
      ]);
    }

    await client.query("commit");
    return (await findThesis(pool, rows[0]!.id, input.userId))!;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function findThesis(
  pool: Pool,
  id: string,
  viewerId: string | null,
): Promise<Thesis | null> {
  const {rows} = await pool.query<ThesisRow>(`${THESIS_SELECT} where t.id = $2`, [viewerId, id]);
  return rows[0] ? toThesis(rows[0]) : null;
}

/// Called when a trade confirms. Until then a thesis simply has no position, because the user wrote
/// their take before they signed.
export async function attachPosition(pool: Pool, thesisId: string, tokenId: bigint): Promise<void> {
  await pool.query(`update theses set token_id = $2 where id = $1 and token_id is null`, [
    thesisId,
    tokenId.toString(),
  ]);
}

export interface LikeResult {
  likeCount: number;
  viewerHasLiked: boolean;
}

/// Idempotent. The primary key makes a repeated like a no-op, and the counter is only moved when a
/// row was actually written, so double-tapping cannot inflate it.
export async function likeThesis(
  pool: Pool,
  thesisId: string,
  userId: string,
): Promise<LikeResult | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const inserted = await client.query(
      `insert into likes (user_id, thesis_id) values ($1, $2) on conflict do nothing`,
      [userId, thesisId],
    );
    if (inserted.rowCount === 1) {
      await client.query(`update theses set like_count = like_count + 1 where id = $1`, [thesisId]);
    }
    const {rows} = await client.query<{like_count: number}>(
      `select like_count from theses where id = $1`,
      [thesisId],
    );
    await client.query("commit");
    return rows[0] ? {likeCount: rows[0].like_count, viewerHasLiked: true} : null;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function unlikeThesis(
  pool: Pool,
  thesisId: string,
  userId: string,
): Promise<LikeResult | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const deleted = await client.query(`delete from likes where user_id = $1 and thesis_id = $2`, [
      userId,
      thesisId,
    ]);
    if (deleted.rowCount === 1) {
      // greatest() so a counter that somehow drifted cannot be driven negative.
      await client.query(
        `update theses set like_count = greatest(like_count - 1, 0) where id = $1`,
        [thesisId],
      );
    }
    const {rows} = await client.query<{like_count: number}>(
      `select like_count from theses where id = $1`,
      [thesisId],
    );
    await client.query("commit");
    return rows[0] ? {likeCount: rows[0].like_count, viewerHasLiked: false} : null;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export interface Comment {
  id: string;
  author: ThesisAuthor;
  body: string;
  createdAt: Date;
}

interface CommentRow {
  id: string;
  body: string;
  created_at: Date;
  author_id: string;
  x_handle: string;
  x_name: string;
  x_avatar_url: string | null;
  wallet_address: string;
}

const toComment = (row: CommentRow): Comment => ({
  id: row.id,
  author: {
    id: row.author_id,
    handle: row.x_handle,
    name: row.x_name,
    avatarUrl: row.x_avatar_url,
    walletAddress: row.wallet_address,
  },
  body: row.body,
  createdAt: row.created_at,
});

export async function createComment(
  pool: Pool,
  thesisId: string,
  userId: string,
  body: string,
): Promise<Comment> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const {rows} = await client.query<{id: string}>(
      `insert into comments (thesis_id, user_id, body) values ($1,$2,$3) returning id`,
      [thesisId, userId, body],
    );
    await client.query(`update theses set comment_count = comment_count + 1 where id = $1`, [
      thesisId,
    ]);
    await client.query("commit");

    const created = await pool.query<CommentRow>(
      `select c.id, c.body, c.created_at, u.id as author_id, u.x_handle, u.x_name,
              u.x_avatar_url, u.wallet_address
       from comments c join users u on u.id = c.user_id where c.id = $1`,
      [rows[0]!.id],
    );
    return toComment(created.rows[0]!);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/// Keyset pagination on (created_at, id). Offsets shift under inserts, which on a feed that is
/// being written to means a reader sees the same row twice or misses one entirely.
export async function listComments(
  pool: Pool,
  thesisId: string,
  limit: number,
  cursor: string | null,
): Promise<{comments: Comment[]; nextCursor: string | null}> {
  const [beforeTime, beforeId] = cursor ? decodeCursor(cursor) : [null, null];

  const {rows} = await pool.query<CommentRow>(
    `select c.id, c.body, c.created_at, u.id as author_id, u.x_handle, u.x_name,
            u.x_avatar_url, u.wallet_address
     from comments c join users u on u.id = c.user_id
     where c.thesis_id = $1
       and ($2::timestamptz is null or (c.created_at, c.id) < ($2::timestamptz, $3::uuid))
     order by c.created_at desc, c.id desc
     limit $4`,
    [thesisId, beforeTime, beforeId, limit + 1],
  );

  return page(rows, limit, toComment, (row) => encodeCursor(row.created_at, row.id));
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}

export function decodeCursor(cursor: string): [string, string] {
  const [time, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (!time || !id) throw new Error("Malformed cursor.");
  return [time, id];
}

/// One extra row is fetched to decide whether there is another page, then dropped. Counting the
/// whole table to answer "is there more" is the expensive way to learn the same thing.
export function page<Row, Item>(
  rows: Row[],
  limit: number,
  map: (row: Row) => Item,
  cursorOf: (row: Row) => string,
): {comments: Item[]; nextCursor: string | null} {
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const last = visible[visible.length - 1];
  return {
    comments: visible.map(map),
    nextCursor: hasMore && last ? cursorOf(last) : null,
  };
}
