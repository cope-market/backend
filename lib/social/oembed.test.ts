import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {createTestDatabase, type TestDatabase} from "../db/testing";
import {EmbedError, normaliseTweetUrl, resolveTweet} from "./oembed";

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(() => db.drop());

const ok = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), {status}));

const embed = {html: "<blockquote>hi</blockquote>", author_name: "Federal Reserve"};

describe("normaliseTweetUrl", () => {
  /// The same tweet pasted from either domain must be one cache entry, not two.
  it("normalises twitter.com and x.com to one form", () => {
    const a = normaliseTweetUrl("https://twitter.com/fed/status/123");
    const b = normaliseTweetUrl("https://x.com/fed/status/123");
    expect(a.url).toBe(b.url);
    expect(a.handle).toBe("fed");
  });

  it("tolerates www and surrounding whitespace", () => {
    expect(normaliseTweetUrl("  https://www.x.com/fed/status/123 ").url).toBe(
      "https://x.com/fed/status/123",
    );
  });

  it.each([
    ["a profile link", "https://x.com/fed"],
    ["another site", "https://example.com/fed/status/1"],
    ["nonsense", "hello"],
  ])("rejects %s", (_label, url) => {
    expect(() => normaliseTweetUrl(url)).toThrow(EmbedError);
  });
});

describe("resolveTweet", () => {
  it("fetches and stores a tweet the first time", async () => {
    const doFetch = ok(embed);
    const {embed: result} = await resolveTweet(
      db.pool,
      "https://x.com/fed/status/1",
      doFetch as unknown as typeof fetch,
    );
    expect(result.authorName).toBe("Federal Reserve");
    expect(doFetch).toHaveBeenCalledOnce();
  });

  /// The point of the cache. X rate-limits, and a feed page would otherwise call it per item.
  it("does not call X again for a tweet it already has", async () => {
    const doFetch = ok(embed);
    await resolveTweet(db.pool, "https://x.com/fed/status/1", doFetch as unknown as typeof fetch);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it("treats twitter.com and x.com as the same cached tweet", async () => {
    const doFetch = ok(embed);
    await resolveTweet(
      db.pool,
      "https://twitter.com/fed/status/1",
      doFetch as unknown as typeof fetch,
    );
    expect(doFetch).not.toHaveBeenCalled();
  });

  /// A deleted or private tweet is a normal thing for a user to paste, not a server fault.
  it("explains an unavailable tweet rather than failing opaquely", async () => {
    await expect(
      resolveTweet(db.pool, "https://x.com/fed/status/404", ok({}, 404) as unknown as typeof fetch),
    ).rejects.toThrow(/deleted, private or suspended/);
  });

  it("reports X being unreachable separately", async () => {
    await expect(
      resolveTweet(db.pool, "https://x.com/fed/status/9", ok({}, 503) as unknown as typeof fetch),
    ).rejects.toThrow(/could not be reached/);
  });

  it("fails when X returns no embed html", async () => {
    await expect(
      resolveTweet(
        db.pool,
        "https://x.com/fed/status/7",
        ok({author_name: "x"}) as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/no embed/i);
  });
});
