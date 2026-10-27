import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csv", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(["a", "b"])).toBe("a; b");
  });

  it("neutralises formulas", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@x")).toBe("'@x");
  });

  it("builds rows", () => {
    expect(toCsv([{ a: 1, b: "x" }], [{ header: "A", value: (r) => r.a }, { header: "B", value: (r) => r.b }])).toBe("A,B\r\n1,x\r\n");
  });
});
