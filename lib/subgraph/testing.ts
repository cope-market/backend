import {SubgraphError, type SubgraphClient} from "./client";

/// A subgraph that answers with a fixed script, for tests that care about what the caller does with
/// the answer rather than about the query.
export function stubSubgraph(responses: Record<string, unknown>): SubgraphClient {
  return {
    url: "https://stub.invalid",
    async query<T>(document: string): Promise<T> {
      for (const [needle, response] of Object.entries(responses)) {
        if (document.includes(needle)) return response as T;
      }
      throw new Error(`stubSubgraph has no response for a query containing any of
${Object.keys(responses).join(", ")}`);
    },
  };
}

/// A subgraph that is down. Callers that degrade must keep working against this one.
export function brokenSubgraph(message = "connection refused"): SubgraphClient {
  return {
    url: "https://stub.invalid",
    async query<T>(): Promise<T> {
      throw new SubgraphError(message, "https://stub.invalid");
    },
  };
}
