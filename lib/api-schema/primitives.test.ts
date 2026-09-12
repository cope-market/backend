import {describe, expect, it} from "vitest";
import {
  Address,
  Amount6,
  ApiError,
  Cursor,
  ErrorCode,
  FeedId,
  IsoDateTime,
  TxHash,
  Wad,
  XHandle,
  paginated,
} from "./primitives";
import {z} from "zod";

describe("Address", () => {
  it("accepts a 20-byte hex address in either case", () => {
    expect(Address.parse("0x2c720283A8Bbb5CC5b13C0C4Bcf2300826286c47")).toBeTruthy();
    expect(Address.parse("0x2c720283a8bbb5cc5b13c0c4bcf2300826286c47")).toBeTruthy();
  });

  it.each([
    ["no prefix", "2c720283A8Bbb5CC5b13C0C4Bcf2300826286c47"],
    ["too short", "0x2c720283"],
    ["not hex", "0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    expect(Address.safeParse(value).success).toBe(false);
  });
});

describe("FeedId", () => {
  it("accepts a 32-byte hex id", () => {
    expect(
      FeedId.parse("0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"),
    ).toBeTruthy();
  });

  /// An address where a feed id belongs parses as hex but addresses the wrong thing entirely.
  it("rejects a 20-byte address", () => {
    expect(FeedId.safeParse("0x2c720283A8Bbb5CC5b13C0C4Bcf2300826286c47").success).toBe(false);
  });
});

describe("TxHash", () => {
  it("accepts a 32-byte hash", () => {
    expect(
      TxHash.parse("0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"),
    ).toBeTruthy();
  });
});

/// Amounts cross the wire as decimal strings. A uint256 does not survive JSON, and a USDC amount
/// in floating point is a rounding bug waiting to happen.
describe("Amount6 and Wad", () => {
  it("accepts canonical non-negative integers", () => {
    expect(Amount6.parse("1998000")).toBe("1998000");
    expect(Amount6.parse("0")).toBe("0");
    expect(Wad.parse("77355490580460000000000")).toBe("77355490580460000000000");
  });

  it.each([
    ["a number", 1998000],
    ["a decimal point", "1.5"],
    ["a negative", "-1"],
    ["empty", ""],
    ["letters", "1e18"],
    ["a leading zero", "007"],
    ["whitespace", " 1 "],
  ])("rejects %s", (_label, value) => {
    expect(Amount6.safeParse(value).success).toBe(false);
  });

  /// P&L and liability are signed. Amounts are not.
  it("has a signed variant that accepts a negative", () => {
    expect(z.string().pipe(Wad).safeParse("-1").success).toBe(false);
  });
});

describe("XHandle", () => {
  it("accepts a handle without the at sign", () => {
    expect(XHandle.parse("cope_market")).toBe("cope_market");
  });

  it.each([
    ["a leading at sign", "@cope"],
    ["too long", "a".repeat(16)],
    ["a space", "co pe"],
  ])("rejects %s", (_label, value) => {
    expect(XHandle.safeParse(value).success).toBe(false);
  });
});

describe("IsoDateTime", () => {
  it("accepts an ISO-8601 instant", () => {
    expect(IsoDateTime.parse("2026-09-12T13:00:00.000Z")).toBeTruthy();
  });

  it("rejects a unix timestamp", () => {
    expect(IsoDateTime.safeParse("1789211873").success).toBe(false);
  });
});

describe("paginated", () => {
  const page = paginated(z.object({id: z.string()}));

  it("wraps rows with a cursor", () => {
    const parsed = page.parse({data: [{id: "a"}], nextCursor: "abc"});
    expect(parsed.data).toHaveLength(1);
    expect(parsed.nextCursor).toBe("abc");
  });

  /// The last page has to be expressible, and null says "no more" where undefined says "unknown".
  it("requires nextCursor to be present and allows null", () => {
    expect(page.parse({data: [], nextCursor: null}).nextCursor).toBeNull();
    expect(page.safeParse({data: []}).success).toBe(false);
  });
});

describe("ApiError", () => {
  it("carries a code and a message", () => {
    const parsed = ApiError.parse({error: {code: "VALIDATION", message: "bad input"}});
    expect(parsed.error.code).toBe("VALIDATION");
  });

  /// Clients switch on these. An open set means a client cannot handle them exhaustively.
  it("rejects a code outside the closed set", () => {
    expect(ApiError.safeParse({error: {code: "SOMETHING_NEW", message: "x"}}).success).toBe(false);
  });

  it("lists the codes clients must handle", () => {
    expect(ErrorCode.options).toContain("UNAUTHORIZED");
    expect(ErrorCode.options).toContain("PRICE_STALE");
    expect(ErrorCode.options).toContain("NOT_FOUND");
  });
});

describe("Cursor", () => {
  it("is an opaque string", () => {
    expect(Cursor.parse("eyJpZCI6IjEifQ")).toBeTruthy();
  });
});
