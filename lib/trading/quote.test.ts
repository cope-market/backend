import {describe, expect, it} from "vitest";
import fixtures from "./fixtures/quotes.json" with {type: "json"};
import {confidenceBps, entryPrice, quoteOpen} from "./quote";

interface Fixture {
  price: string;
  conf: string;
  collateral: string;
  openFeeBps: number;
  isLong: boolean;
  expectedNetCollateral: string;
  expectedEntryPrice: string;
  expectedUnits: string;
}

const cases = fixtures as Fixture[];

/// These expectations were produced by opening real positions against the real contract and reading
/// back what it stored. Parity is therefore proven against the implementation rather than against a
/// reading of it. Regenerate with `forge test --match-contract GenerateQuoteFixtures` in the
/// contracts repo and copy out/parity/quotes.json here.
describe("parity with SyntheticVault.open", () => {
  it("has a meaningful number of cases", () => {
    expect(cases.length).toBeGreaterThan(30);
  });

  it.each(cases)(
    "price=$price conf=$conf collateral=$collateral fee=$openFeeBps long=$isLong",
    (fixture) => {
      const result = quoteOpen({
        price: BigInt(fixture.price),
        conf: BigInt(fixture.conf),
        collateral: BigInt(fixture.collateral),
        openFeeBps: fixture.openFeeBps,
        isLong: fixture.isLong,
      });

      expect(result.netCollateral.toString()).toBe(fixture.expectedNetCollateral);
      expect(result.entryPrice.toString()).toBe(fixture.expectedEntryPrice);
      expect(result.units.toString()).toBe(fixture.expectedUnits);
    },
  );
});

describe("entryPrice", () => {
  /// Skewing only on entry, or the wrong way, hands the protection to the trader instead.
  it("moves the price against the trader on both sides", () => {
    expect(entryPrice(100n, 5n, true)).toBe(105n);
    expect(entryPrice(100n, 5n, false)).toBe(95n);
  });
});

describe("confidenceBps", () => {
  it("expresses confidence as a fraction of price", () => {
    expect(confidenceBps(10_000n, 100n)).toBe(100n);
    expect(confidenceBps(10_000n, 0n)).toBe(0n);
  });

  /// A zero price is not a market. Reporting maximum uncertainty makes the caller reject it rather
  /// than divide by zero.
  it("treats a zero price as maximally uncertain", () => {
    expect(confidenceBps(0n, 1n)).toBe(10_000n);
  });
});

describe("quoteOpen", () => {
  it("refuses a confidence interval wider than the price", () => {
    expect(() =>
      quoteOpen({price: 100n, conf: 200n, collateral: 1_000_000n, openFeeBps: 0, isLong: false}),
    ).toThrow(/wider than the price/i);
  });
});
