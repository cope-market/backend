import {describe, expect, it} from "vitest";
import type {SubgraphClient} from "./client";
import {EMPTY_TOTALS, normaliseAddress, traderTotals, windowedTotals, winRateOf} from "./traders";

const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";
const WAD = 10n ** 18n;

interface Call {
  document: string;
  variables: Record<string, unknown>;
}

/// Answers with whatever the script says, and records what it was asked.
function fakeClient(pages: unknown[]): {client: SubgraphClient; calls: Call[]} {
  const calls: Call[] = [];
  let index = 0;
  return {
    calls,
    client: {
      url: "https://example.invalid",
      async query<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
        calls.push({document, variables});
        const page = pages[Math.min(index, pages.length - 1)];
        index += 1;
        return page as T;
      },
    },
  };
}

function traderRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    positionsOpened: 5,
    positionsClosed: 2,
    realizedPnlWad: WAD.toString(),
    wins: 1,
    losses: 1,
    copiesReceived: 3,
    authorFeesEarned: "100000",
    ...overrides,
  };
}

describe("lifetime totals", () => {
  it("keys on the address and derives what is still open", async () => {
    const {client} = fakeClient([{traders: [traderRow(ALICE)]}]);
    const totals = await traderTotals(client, [ALICE]);

    expect(totals.get(ALICE)).toEqual({
      realizedPnlWad: WAD.toString(),
      openPositions: 3,
      closedPositions: 2,
      wins: 1,
      losses: 1,
      copiesReceived: 3,
      authorFeesEarned: "100000",
    });
  });

  /// The subgraph answers in lower-case whatever case went in. A map keyed on the checksummed form
  /// would miss every row it just fetched.
  it("matches a checksummed address to a lower-case answer", async () => {
    const {client, calls} = fakeClient([{traders: [traderRow(ALICE)]}]);
    const checksummed = "0x1111111111111111111111111111111111111111"
      .toUpperCase()
      .replace("0X", "0x");
    const totals = await traderTotals(client, [checksummed]);

    expect(calls[0]!.variables.ids).toEqual([ALICE]);
    expect(totals.get(normaliseAddress(checksummed))).toBeDefined();
  });

  /// An address that never traded has no row at all. Absent means nothing happened, which is not
  /// the same as something failing, and the caller substitutes zeros rather than erroring.
  it("omits an address the subgraph has never seen", async () => {
    const {client} = fakeClient([{traders: []}]);
    const totals = await traderTotals(client, [ALICE]);

    expect(totals.has(ALICE)).toBe(false);
    expect(totals.get(ALICE) ?? EMPTY_TOTALS).toEqual(EMPTY_TOTALS);
  });

  it("asks nothing when given no addresses", async () => {
    const {client, calls} = fakeClient([{traders: []}]);
    await expect(traderTotals(client, [])).resolves.toEqual(new Map());
    expect(calls).toHaveLength(0);
  });

  it("de-duplicates addresses before asking", async () => {
    const {client, calls} = fakeClient([{traders: [traderRow(ALICE)]}]);
    await traderTotals(client, [ALICE, ALICE, ALICE.toUpperCase().replace("0X", "0x")]);
    expect(calls[0]!.variables.ids).toEqual([ALICE]);
  });

  /// A close is counted against the position's author, who may not be whoever closed it, and
  /// nothing guarantees the two events arrive in order across a reorg.
  it("never reports a negative open count", async () => {
    const {client} = fakeClient([
      {traders: [traderRow(ALICE, {positionsOpened: 1, positionsClosed: 4})]},
    ]);
    const totals = await traderTotals(client, [ALICE]);
    expect(totals.get(ALICE)!.openPositions).toBe(0);
  });

  it("rejects a response whose shape is wrong", async () => {
    const {client} = fakeClient([{traders: [{id: ALICE, wins: "three"}]}]);
    await expect(traderTotals(client, [ALICE])).rejects.toThrow();
  });
});

describe("windowed totals", () => {
  function position(id: string, author: string, pnl: bigint | null) {
    return {id, author: {id: author}, realizedPnlWad: pnl === null ? null : pnl.toString()};
  }

  it("sums per author and counts wins and losses", async () => {
    const {client} = fakeClient([
      {
        positions: [
          position("0x01", ALICE, 3n * WAD),
          position("0x02", ALICE, -1n * WAD),
          position("0x03", BOB, 5n * WAD),
        ],
      },
    ]);
    const totals = await windowedTotals(client, [ALICE, BOB], 0);

    expect(totals.get(ALICE)).toEqual({
      realizedPnlWad: (2n * WAD).toString(),
      closedPositions: 2,
      wins: 1,
      losses: 1,
    });
    expect(totals.get(BOB)!.wins).toBe(1);
  });

  /// Rounding lands on zero often enough that counting it as a win would inflate every win rate on
  /// the board. Strictly positive also keeps wins + losses equal to closedPositions.
  it("counts a flat close as a loss", async () => {
    const {client} = fakeClient([{positions: [position("0x01", ALICE, 0n)]}]);
    const totals = await windowedTotals(client, [ALICE], 0);

    expect(totals.get(ALICE)).toEqual({
      realizedPnlWad: "0",
      closedPositions: 1,
      wins: 0,
      losses: 1,
    });
  });

  it("passes the window as a cutoff the subgraph can filter on", async () => {
    const {client, calls} = fakeClient([{positions: []}]);
    await windowedTotals(client, [ALICE], 1757660400);
    expect(calls[0]!.variables.since).toBe("1757660400");
    expect(calls[0]!.variables.authors).toEqual([ALICE]);
  });

  /// graph-node caps `skip` at 5000, so paging has to walk a cursor. A board that silently stopped
  /// counting past that point would look right and rank wrong.
  it("pages with a cursor until a short page arrives", async () => {
    const full = Array.from({length: 1000}, (_, i) =>
      position(`0x${String(i).padStart(4, "0")}`, ALICE, WAD),
    );
    const {client, calls} = fakeClient([
      {positions: full},
      {positions: [position("0xffff", ALICE, WAD)]},
    ]);
    const totals = await windowedTotals(client, [ALICE], 0);

    expect(calls).toHaveLength(2);
    expect(calls[0]!.variables.after).toBe("0x");
    expect(calls[1]!.variables.after).toBe(full[999]!.id);
    expect(totals.get(ALICE)!.closedPositions).toBe(1001);
  });

  it("stops after one page when the page is short", async () => {
    const {client, calls} = fakeClient([{positions: [position("0x01", ALICE, WAD)]}]);
    await windowedTotals(client, [ALICE], 0);
    expect(calls).toHaveLength(1);
  });

  /// A closed position always carries a P&L. Reading a malformed row as zero keeps it out of the
  /// win column rather than letting it invent a ranking.
  it("treats a missing P&L as zero, which is a loss", async () => {
    const {client} = fakeClient([{positions: [position("0x01", ALICE, null)]}]);
    const totals = await windowedTotals(client, [ALICE], 0);
    expect(totals.get(ALICE)).toEqual({
      realizedPnlWad: "0",
      closedPositions: 1,
      wins: 0,
      losses: 1,
    });
  });

  it("asks nothing when given no addresses", async () => {
    const {client, calls} = fakeClient([{positions: []}]);
    await expect(windowedTotals(client, [], 0)).resolves.toEqual(new Map());
    expect(calls).toHaveLength(0);
  });

  /// Values well past 2^53. Summing these as numbers would lose the low digits of every figure on
  /// the board.
  it("sums beyond what a JavaScript number can hold", async () => {
    const huge = 12_345_678n * WAD;
    const {client} = fakeClient([
      {positions: [position("0x01", ALICE, huge), position("0x02", ALICE, huge)]},
    ]);
    const totals = await windowedTotals(client, [ALICE], 0);
    expect(totals.get(ALICE)!.realizedPnlWad).toBe((2n * huge).toString());
  });
});

describe("win rate", () => {
  it("is the share of decided positions that won", () => {
    expect(winRateOf(3, 1)).toBe(0.75);
  });

  /// A trader who has closed nothing has no win rate. Zero is the only answer that does not claim
  /// something about them.
  it("is zero for a trader who has closed nothing", () => {
    expect(winRateOf(0, 0)).toBe(0);
  });

  it("is one when nothing was lost", () => {
    expect(winRateOf(4, 0)).toBe(1);
  });
});
