import { describe, expect, it } from "vitest";
import { href, qNum, qStr } from "./router";

describe("hash router helpers", () => {
  it("builds hash links and drops empty query values", () => {
    expect(href("/shots", { exp: "a", shot: 7, empty: "", none: undefined })).toBe("#/shots?exp=a&shot=7");
    expect(href("/")).toBe("#/");
  });
  it("reads typed query parameters with fallbacks", () => {
    const q = new URLSearchParams("p=0.12&bad=abc&s=x");
    expect(qNum(q, "p", 0)).toBe(0.12);
    expect(qNum(q, "bad", 3)).toBe(3);
    expect(qNum(q, "missing", 5)).toBe(5);
    expect(qStr(q, "s", "y")).toBe("x");
    expect(qStr(q, "missing", "y")).toBe("y");
  });
});
