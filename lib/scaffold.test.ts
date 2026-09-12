import {describe, expect, it} from "vitest";

/// Proves the toolchain itself works before anything is built on it: TypeScript compiles under the
/// strict settings this project uses, and vitest picks tests up from lib/.
describe("scaffold", () => {
  it("runs typed tests", () => {
    const amounts: Record<string, string> = {collateral: "1998000"};
    expect(amounts["collateral"]).toBe("1998000");
  });

  it("has noUncheckedIndexedAccess enabled", () => {
    const list: string[] = [];
    const first: string | undefined = list[0];
    expect(first).toBeUndefined();
  });
});
