import type {Pool} from "pg";

/// Tweet embeds, fetched from X once per URL and cached.
///
/// X's oEmbed endpoint is public and needs no key, but it has no CORS headers, so a browser cannot
/// call it, and it rate-limits, so fetching per page view would not survive a demo.

export interface TweetEmbed {
  tweetUrl: string;
  authorHandle: string;
  authorName: string;
  html: string;
  fetchedAt: Date;
}

export class EmbedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbedError";
  }
}

const TWEET_URL =
  /^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/;

/// Accepts either domain and normalises to one form, so the same tweet posted as twitter.com and
/// x.com is one cache entry rather than two.
export function normaliseTweetUrl(input: string): {url: string; handle: string; id: string} {
  const match = TWEET_URL.exec(input.trim());
  if (!match) throw new EmbedError("That does not look like a link to a tweet.");
  const handle = match[1] as string;
  const id = match[2] as string;
  return {url: `https://x.com/${handle}/status/${id}`, handle, id};
}

interface OEmbedResponse {
  html?: string;
  author_name?: string;
}

async function fetchFromX(url: string, doFetch: typeof fetch): Promise<OEmbedResponse> {
  const endpoint = new URL("https://publish.twitter.com/oembed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("omit_script", "true");
  endpoint.searchParams.set("dnt", "true");

  const response = await doFetch(endpoint.toString());

  // 404 means deleted, private or suspended. That is a normal thing for a user to paste, and it
  // deserves a clear answer rather than a 500.
  if (response.status === 404) {
    throw new EmbedError("That tweet is unavailable. It may be deleted, private or suspended.");
  }
  if (!response.ok) {
    throw new EmbedError(`X could not be reached right now (HTTP ${response.status}).`);
  }
  return (await response.json()) as OEmbedResponse;
}

interface EmbedRow {
  id: string;
  tweet_url: string;
  author_handle: string;
  author_name: string;
  oembed_html: string;
  fetched_at: Date;
}

const toEmbed = (row: EmbedRow): TweetEmbed => ({
  tweetUrl: row.tweet_url,
  authorHandle: row.author_handle,
  authorName: row.author_name,
  html: row.oembed_html,
  fetchedAt: row.fetched_at,
});

export async function resolveTweet(
  pool: Pool,
  rawUrl: string,
  doFetch: typeof fetch = fetch,
): Promise<{embed: TweetEmbed; eventId: string}> {
  const {url, handle} = normaliseTweetUrl(rawUrl);

  const cached = await pool.query<EmbedRow>(`select * from events where tweet_url = $1`, [url]);
  if (cached.rows[0]) {
    return {embed: toEmbed(cached.rows[0]), eventId: cached.rows[0].id};
  }

  const fetched = await fetchFromX(url, doFetch);
  if (!fetched.html) throw new EmbedError("X returned no embed for that tweet.");

  const {rows} = await pool.query<EmbedRow>(
    `insert into events (tweet_url, author_handle, author_name, oembed_html)
     values ($1, $2, $3, $4)
     -- Two people can paste the same tweet at the same moment. Neither should fail.
     on conflict (tweet_url) do update set fetched_at = events.fetched_at
     returning *`,
    [url, handle, fetched.author_name ?? handle, fetched.html],
  );
  return {embed: toEmbed(rows[0]!), eventId: rows[0]!.id};
}
