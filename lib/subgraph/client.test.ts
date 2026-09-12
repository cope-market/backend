import {afterEach, describe, expect, it, vi} from "vitest";
import {SubgraphError, createSubgraphClient} from "./client";

const URL = "https://example.invalid/subgraph";

function stubFetch(implementation: typeof fetch) {
  vi.stubGlobal("fetch", implementation);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("a successful query", () => {
  it("returns the data", async () => {
    stubFetch(async () => Response.json({data: {trader: {wins: 3}}}));
    const client = createSubgraphClient(URL);
    await expect(client.query("{ trader { wins } }")).resolves.toEqual({trader: {wins: 3}});
  });

  it("posts the document and the variables", async () => {
    let body: unknown;
    stubFetch(async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({data: {}});
    });
    await createSubgraphClient(URL).query("query Q($id: ID!) { trader(id: $id) { wins } }", {
      id: "0xabc",
    });
    expect(body).toEqual({
      query: "query Q($id: ID!) { trader(id: $id) { wins } }",
      variables: {id: "0xabc"},
    });
  });
});

describe("failures", () => {
  /// The one that matters. A GraphQL error arrives as HTTP 200 with a `data` of nulls, so a client
  /// that checks only `response.ok` reads a failed query as a successful one.
  it("treats a GraphQL error as a failure even though the status is 200", async () => {
    stubFetch(async () =>
      Response.json({data: null, errors: [{message: "Unknown field `wns`"}]}, {status: 200}),
    );
    await expect(createSubgraphClient(URL).query("{ wns }")).rejects.toThrow(
      /rejected the query.*Unknown field/,
    );
  });

  it("reports every GraphQL error, not just the first", async () => {
    stubFetch(async () =>
      Response.json({errors: [{message: "first thing"}, {message: "second thing"}]}),
    );
    await expect(createSubgraphClient(URL).query("{ x }")).rejects.toThrow(
      /first thing; second thing/,
    );
  });

  it("rejects a non-2xx status", async () => {
    stubFetch(async () => new Response("gateway blew up", {status: 502}));
    await expect(createSubgraphClient(URL).query("{ x }")).rejects.toThrow(/HTTP 502/);
  });

  it("rejects a body that is not JSON", async () => {
    stubFetch(async () => new Response("<html>maintenance</html>", {status: 200}));
    await expect(createSubgraphClient(URL).query("{ x }")).rejects.toThrow(/not JSON/);
  });

  /// An answer with neither data nor errors is not success. Returning it would hand the caller
  /// undefined and move the crash somewhere less informative.
  it("rejects an answer with neither data nor errors", async () => {
    stubFetch(async () => Response.json({}));
    await expect(createSubgraphClient(URL).query("{ x }")).rejects.toThrow(/no data and no errors/);
  });

  it("rejects when the network is unreachable", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(createSubgraphClient(URL).query("{ x }")).rejects.toThrow(/unreachable/);
  });

  /// A hung indexer would otherwise hold the request open until the platform kills it.
  it("gives up when the subgraph does not answer", async () => {
    stubFetch(
      async (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), {name: "AbortError"}));
          });
        }),
    );
    await expect(createSubgraphClient(URL, 10).query("{ x }")).rejects.toThrow(
      /did not answer within 10ms/,
    );
  });

  it("carries the url, so a log says which subgraph failed", async () => {
    stubFetch(async () => new Response("nope", {status: 500}));
    await expect(createSubgraphClient(URL).query("{ x }")).rejects.toMatchObject({
      name: "SubgraphError",
      url: URL,
    });
    expect(new SubgraphError("x", URL).url).toBe(URL);
  });
});
