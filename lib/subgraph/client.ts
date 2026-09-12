import {requireEnv} from "../env";

/// A GraphQL client for the subgraphs, with the three things `fetch` does not give you.
///
/// A timeout, because a hung indexer would otherwise hold a request open until the platform kills
/// it. An error check, because GraphQL answers HTTP 200 with an `errors` array and a `data` of
/// nulls — a client that only checks `response.ok` reads that as success. And a single place to
/// decide what a failure means, so callers do not each invent their own.

export class SubgraphError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message);
    this.name = "SubgraphError";
  }
}

export interface SubgraphClient {
  query<T>(document: string, variables?: Record<string, unknown>): Promise<T>;
  readonly url: string;
}

const DEFAULT_TIMEOUT_MS = 8000;

interface GraphQLResponse<T> {
  data?: T;
  errors?: {message: string}[];
}

export function createSubgraphClient(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): SubgraphClient {
  return {
    url,
    async query<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {"content-type": "application/json"},
          body: JSON.stringify({query: document, variables}),
          signal: controller.signal,
          // The indexer's answer changes only when a block is indexed, and Next would otherwise
          // cache this for the lifetime of the process.
          cache: "no-store",
        });
      } catch (error) {
        const reason =
          error instanceof Error && error.name === "AbortError"
            ? `did not answer within ${timeoutMs}ms`
            : `is unreachable: ${error instanceof Error ? error.message : String(error)}`;
        throw new SubgraphError(`The subgraph ${reason}.`, url);
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        throw new SubgraphError(`The subgraph answered HTTP ${response.status}.`, url);
      }

      let body: GraphQLResponse<T>;
      try {
        body = (await response.json()) as GraphQLResponse<T>;
      } catch {
        throw new SubgraphError("The subgraph answered with something that is not JSON.", url);
      }

      // A GraphQL error arrives as HTTP 200. Checking `response.ok` alone reads a failed query as a
      // successful one and hands the caller a `data` full of nulls.
      if (body.errors && body.errors.length > 0) {
        throw new SubgraphError(
          `The subgraph rejected the query: ${body.errors.map((e) => e.message).join("; ")}`,
          url,
        );
      }

      if (body.data === undefined || body.data === null) {
        throw new SubgraphError("The subgraph answered with no data and no errors.", url);
      }

      return body.data;
    },
  };
}

let cached: SubgraphClient | null = null;

/// The Cope Market subgraph: positions, the copy graph and realised P&L.
export function getSubgraphClient(): SubgraphClient {
  if (cached === null) {
    cached = createSubgraphClient(requireEnv("COPE_SUBGRAPH_URL"));
  }
  return cached;
}

/// Test seam. Passing null restores the environment-configured client.
export function setSubgraphClient(client: SubgraphClient | null): void {
  cached = client;
}
