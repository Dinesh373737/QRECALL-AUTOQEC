import { describe, expect, it } from "vitest";
import { ci, expLabel, fix, int, pct, sci, shortExp, signedPct, us } from "./format";
import { toCsv } from "./api";

describe("number formatting", () => {
  it("formats rates, intervals and missing values without inventing numbers", () => {
    expect(pct(0.1234, 1)).toBe("12.3%");
    expect(pct(null)).toBe("—");
    expect(pct(Number.NaN)).toBe("—");
    expect(ci([0.01, 0.02], 1)).toBe("[1.0%, 2.0%]");
    expect(ci(undefined)).toBe("—");
    expect(fix(1.23456, 2)).toBe("1.23");
    expect(int(1234567)).toBe("1,234,567");
    expect(signedPct(-12.34)).toBe("-12.3%");
    expect(signedPct(5)).toBe("+5.0%");
  });

  it("uses scientific notation only for very small or large magnitudes", () => {
    expect(sci(0.5)).toBe("0.5");
    expect(sci(0.0001234)).toBe("1.23e-4");
    expect(sci(0)).toBe("0");
  });

  it("shows a dash when there is no latency figure", () => {
    expect(us(null)).toBe("—");
    expect(us(3.2)).toBe("3.20 µs");
    expect(us(2500)).toBe("2.50 ms");
    expect(us(3_000_000)).toBe("3.00 s");
  });
});

describe("experiment labels", () => {
  it("parses Google experiment directory names", () => {
    expect(expLabel("surface_code_bZ_d3_r05_center_3_5")).toBe("Surface d=3 · Z-basis · 5 rounds · @(3,5)");
    expect(shortExp("repetition_code_bZ_d25_r50_center_5_5")).toBe("RC d25 Z r50 (5,5)");
    expect(expLabel("not_an_id")).toBe("not_an_id");
  });
});

describe("csv export", () => {
  it("quotes values containing separators and serializes objects", () => {
    const csv = toCsv([{ a: 1, b: "x,y", c: { k: 2 } }, { a: null, b: 'q"t', c: [1] }]);
    expect(csv.split("\n")[0]).toBe("a,b,c");
    expect(csv).toContain('"x,y"');
    expect(csv).toContain('"q""t"');
    expect(csv).toContain('"{""k"":2}"');
  });
});
