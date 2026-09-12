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

---

# Workstream 2: Foundation — persistence, auth, and the handler layer

Workstream 1 declared the API. This one makes a first slice of it real, and builds the machinery
every later endpoint reuses: a database, verified identity, and a way to turn a route definition
into a running handler.

The endpoints delivered here are deliberately the boring ones. Configuration and profile are enough
to prove the whole path end to end — request in, validated, authenticated, persisted, response out —
without the extra risk of money moving. Trade flow comes next, on top of machinery that already
works.

---

## Decisions this workstream is built on

**Plain Postgres, not Supabase.** The price pusher already has to run continuously on a VPS, so the
box exists either way. A long-lived Node process removes the connection-pooling problem that makes
serverless Postgres awkward, and self-hosting sidesteps free-tier projects pausing after a week of
inactivity — judges open a demo days after submission, and a paused database is a broken demo.

**No ORM.** Typed SQL with a thin query layer. The schema is small and the queries are simple; an
ORM would add a dependency, a build step and a layer of indirection to save very little.

**Migrations are plain SQL files, applied in order and recorded.** Reproducible on a fresh box, and
readable by anyone who knows SQL rather than anyone who knows a particular tool.

**The database stores social content and intent records only.** Financial state lives on-chain. If
Postgres is lost, every position, balance and copy relationship survives.

**Privy tokens are verified locally against Privy's public key**, not by calling their API on every
request. A network round trip per request is a latency cost and an availability dependency for
something that is a signature check.

---

## Steps

Each step ends with `npm run check` green, a commit and a push.

| #       | Step                     | Done when                                                                                                                          |
| ------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **2.1** | Postgres and migrations  | `docker compose up -d` gives a database; migrations apply and re-apply cleanly; a test proves the runner is idempotent             |
| **2.2** | Query layer              | Typed access to the pool, transactions, and a test proving a failed transaction rolls back                                         |
| **2.3** | Users schema and queries | `users` table with the Privy identity as its key; upsert on first sight; tests against real Postgres                               |
| **2.4** | Privy token verification | A token is verified locally; expired, malformed and wrong-audience tokens are each rejected with their own error                   |
| **2.5** | Handler layer            | `defineHandler(route, impl)` validates params, query and body, enforces auth, and maps thrown errors onto the declared error codes |
| **2.6** | Configuration endpoints  | `GET chains` and `GET assets` serve real config, driven by environment rather than hard-coded                                      |
| **2.7** | Profile endpoints        | `POST auth/session`, `GET me`, `PATCH me` against real Postgres                                                                    |
| **2.8** | Verification             | Fresh clone, fresh database, migrations, full suite, and the typed client driven against the real server rather than the mock      |

---

## What this workstream does not do

No trade flow, no social content, no subgraph, no price pusher. Those land on the machinery built
here.

The mock server stays. It is what the frontend uses for routes that are not yet real, and the
contract tests keep both honest.

---

# Workstream 3: Trade flow

Opening and closing positions through the API. This is where money moves, so it gets the care the
contracts got.

---

## The problem this workstream has to solve carefully

`SyntheticVault` has no `quote` view. The entry price, units and fee a user is shown before they
sign have to be computed off-chain, and they have to match what the contract will actually do.

Three ways that could go wrong, and what this plan does about each:

**The maths drifts from the contract.** The fee is taken in 6-decimal space, the entry price is the
oracle mid moved against the trader by the confidence interval, and units are net notional divided
by that entry. Getting any of it subtly wrong quotes a user one number and fills them at another.

_Mitigation: parity fixtures generated from the contract itself._ A Foundry script emits input and
expected-output pairs, those are committed here, and the TypeScript tests assert against them. Then
parity is proven against the real implementation rather than against a careful reading of it.

**A quote is accepted that the contract will reject.** Stale price, confidence too wide, asset
disabled, position or open-interest cap exceeded, pool cannot cover the payout.

_Mitigation: simulate the call._ Before returning an intent, `eth_call` the transaction we are about
to hand over. If the contract would revert, the user finds out before signing rather than after
paying gas.

**A confirm is lost.** The client sends the transaction and then loses the response, so the trade is
on-chain and unknown to us.

_Mitigation: the intent is recorded before the transaction is built,_ and `GET trades/{id}` can
recover it. The receipt, not the client, is the source of truth for what happened.

---

## Decisions

**Amounts stay strings end to end.** They arrive as decimal strings, become bigint for arithmetic
and encoding, and go back out as strings. A JavaScript number never touches a token amount.

**The chain is the source of truth for state; the database records intent.** A `trades` row says
what a user meant to do. What actually happened is read from the receipt.

**Quotes expire.** Thirty seconds, matched to how long a price stays acceptable. An expired intent
is refused rather than re-priced silently.

---

## Steps

| #       | Step                       | Done when                                                                                                                         |
| ------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **3.1** | Chain client               | viem client, contract ABIs, and typed reads for asset config, oracle price, positions and vault state, tested against Arc testnet |
| **3.2** | Quote maths and parity     | Fee, entry price and units in TypeScript, asserted against fixtures generated by a Foundry script from the contract               |
| **3.3** | Pre-trade validation       | Asset enabled, price fresh, confidence within bounds, caps respected, pool able to cover; each with its own error code            |
| **3.4** | Trades table               | Intent records, status transitions, and the constraint that one transaction hash settles one trade                                |
| **3.5** | `POST trades/intent`       | Returns a quote and an unsigned transaction, simulated before it is handed over                                                   |
| **3.6** | `POST trades/{id}/confirm` | Verifies the receipt, parses the event, links the position to its thesis                                                          |
| **3.7** | Close, cancel, poll        | `positions/{tokenId}/close-intent`, `trades/{id}/cancel`, `GET trades/{id}`                                                       |
| **3.8** | Verification               | A real position opened and closed on Arc testnet through the API, with the database and the chain agreeing afterwards             |

## Out of scope

Social content, feed ranking and the subgraph. A trade can reference a thesis id, but creating
theses is workstream 4.

---

# Workstream 4: Social layer

Theses, tweet embeds, likes, comments, follows, the ranked feed and the leaderboard. This is the
part of the product that is not a trade: the reason somebody opens the app rather than a DEX.

---

## What this has to get right

**A thesis and its position are linked but separate.** The thesis is written before the trade is
confirmed — a user types their take, then signs. The position attaches when the trade confirms, and
until then the thesis simply has no `tokenId`. A design that required them together would mean
either holding a draft hostage to a signature or writing a row for a trade that never happened.

**Live P&L is never copied into the database.** A thesis carries a `tokenId` and the client reads
the position from the chain. Mirroring it would create a second source of truth that is wrong
between refreshes.

**Ranking runs in SQL, not in the application.** Sorting a feed by fetching every row and scoring it
in TypeScript stops working at the first thousand rows, and cursor pagination over an
application-sorted list cannot be made stable.

---

## Decisions

**Tweet embeds are cached server-side.** X's oEmbed endpoint has no CORS headers, so a browser
cannot call it, and it rate-limits, so calling it per page view would not survive a demo. One row
per tweet URL, fetched once.

**The ranking formula runs without P&L for now.** The intended score weights realised performance,
and that number comes from the subgraph, which is workstream 5. Ranking today uses likes, comments,
copies and age. The formula is written so the P&L term slots in without reshaping the query.

**The leaderboard ranks on what can actually be measured today** — copies received and positions
closed. Realised P&L joins when the subgraph does. A leaderboard showing zeros for its headline
column would be worse than one honest about what it is sorting on.

**Counters are denormalised and maintained in the same transaction as the action.** A feed query
that counts likes per thesis on every read is the query that gets slow first.

---

## Steps

| #       | Step               | Done when                                                                                                                    |
| ------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **4.1** | Social schema      | events, theses, likes, comments and follows, with the counters the feed reads                                                |
| **4.2** | Tweet embeds       | X oEmbed fetched once per URL and cached; a bad or private tweet fails with its own error                                    |
| **4.3** | Theses             | Create and read, with the position attaching when a trade confirms                                                           |
| **4.4** | Likes and comments | Idempotent likes, paginated comments, counters that stay correct under repeat calls                                          |
| **4.5** | Follows and stats  | Follow and unfollow, and profile stats that stop being zeros                                                                 |
| **4.6** | Feed               | latest, top and following, ranked in SQL with stable cursor pagination                                                       |
| **4.7** | Leaderboard        | Ranked on measurable columns, over the three windows                                                                         |
| **4.8** | Verification       | The full loop against a real database: post a thesis with a real trade, have a second user copy it, and see both in the feed |

## Out of scope

The subgraph, and therefore realised P&L anywhere it would appear. Notifications and devices have
routes and fixtures already; delivery is not being built.
