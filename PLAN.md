# Backend — Workstream 1: API contract and mock server

The goal of this workstream is to unblock the frontend. When it is done, the frontend agent can
build every screen against a typed client and a running mock, and none of that work has to change
when the real endpoints land behind the same shapes.

Nothing here talks to a database or to the chain. That is workstream 2.

---

## Decisions this workstream is built on

**The frontend reads the chain directly wherever it can.** Positions, asset config, open interest,
liability, liquidity-vault state and prices all come from the contracts with viem. The API does not
wrap them. `INTEGRATION.md` documents those calls.

**The API covers only what the chain cannot answer.** Three categories:

1. Social content: theses, comments, likes, follows, profiles. None of it belongs on-chain.
2. Data that needs a server: tweet oEmbed (no CORS, needs caching), ranked feed, leaderboard.
3. Metadata that does not exist on-chain: a feed id is a `bytes32`. Turning it into "EUR/USD" with a
   name, an asset class and a logo needs a catalogue.

**Trade intent and confirm stay in the API**, even though the frontend could call the contracts
itself. Two reasons: validation belongs on the server, and a trade has to be linked to a thesis,
which is database state. A dropped confirm is recoverable because the intent was recorded.

**One definition, three consumers.** Each route is declared once with zod schemas. The OpenAPI
document, the typed client and the mock server are all derived from that declaration. They cannot
drift, because there is nothing to keep in sync.

---

## Steps

Each step ends with tests passing, a commit and a push.

| #       | Step                     | Done when                                                                                                          |
| ------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **1.1** | Scaffold                 | Next.js App Router, TypeScript strict, vitest, lint and format all run clean on an empty project                   |
| **1.2** | Route registry primitive | `defineRoute` exists and its types are proven by tests that fail to compile when misused                           |
| **1.3** | Shared schemas           | Address, Hex, FeedId, decimal-string amounts, cursor pagination and the error envelope, each with round-trip tests |
| **1.4** | Route definitions        | Every endpoint declared. Tests assert unique method+path, unique operationId, and auth marked explicitly           |
| **1.5** | OpenAPI generation       | `public/openapi.json` is generated, valid 3.1, and CI fails when it is stale                                       |
| **1.6** | Typed client             | `apiClient.get("feed", {...})` infers argument and return types from the registry                                  |
| **1.7** | Fixtures and mock server | `npm run mock` serves every route with realistic data and no database                                              |
| **1.8** | Verification             | Full suite, spec lint, a curl against the running mock, and `INTEGRATION.md` updated                               |

---

## Conventions, fixed here so they are not re-litigated later

These exist to make the generated Swift client clean and to stop the frontend guessing.

- **Amounts are decimal strings**, never numbers. A `uint256` does not survive JSON, and a USDC
  amount in floating point is a rounding bug waiting to happen. `"1998000"`, not `1998000`.
- **Every amount field names its unit** in the schema description: 6-decimal USDC, or 1e18 wad.
- **Dates are ISO-8601 strings.**
- **Errors are `{ error: { code, message } }`** with a closed set of codes.
- **Pagination is `{ data, nextCursor }`.** Cursors are opaque strings.
- **Every route has an `operationId`.** Swift code generation needs it.
- **No `oneOf` in responses.** It generates badly in Swift.
- **Auth is explicit per route**, never inferred from the path.

## Out of scope for workstream 1

No database, no chain calls, no Privy verification against the live service. The auth route is
declared and mocked. It is wired up in workstream 2, once Alok supplies a Privy app ID.
