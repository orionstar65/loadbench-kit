import { describe, it, expect } from "@jest/globals";
import usage, {
  UnitsToBytes,
  toBytes,
} from "loadbench-kit/docker/usage.js";

describe("usage", () => {
  describe("parse", () => {
    it('parses "1.5GiB" correctly', () => {
      expect(usage.parse("1.5GiB")).toEqual({ value: 1.5, units: "GiB" });
    });

    it('parses "100 MB" with whitespace', () => {
      expect(usage.parse("100 MB")).toEqual({ value: 100, units: "MB" });
    });

    it('parses "0B"', () => {
      expect(usage.parse("0B")).toEqual({ value: 0, units: "B" });
    });

    it('parses "1.5kB"', () => {
      expect(usage.parse("1.5kB")).toEqual({ value: 1.5, units: "kB" });
    });

    it("throws on empty string", () => {
      expect(() => usage.parse("")).toThrow();
    });

    it("throws on string without units", () => {
      expect(() => usage.parse("no-units")).toThrow();
    });

    it('throws on compound string "100 MB / 200 MB"', () => {
      expect(() => usage.parse("100 MB / 200 MB")).toThrow();
    });
  });

  describe("convert", () => {
    it("converts 1 GiB to MB (cross-unit)", () => {
      const result = usage.convert({ value: 1, units: "GiB" }, "MB");
      expect(result).toEqual({ value: 1073.74, units: "MB" });
    });

    it("converts 0 MB to B", () => {
      expect(usage.convert({ value: 0, units: "MB" }, "B")).toEqual({
        value: 0,
        units: "B",
      });
    });

    it("converts same unit (identity)", () => {
      expect(usage.convert({ value: 1, units: "MB" }, "MB")).toEqual({
        value: 1,
        units: "MB",
      });
    });
  });

  describe("toBytes", () => {
    it("converts 120 MiB to bytes", () => {
      expect(toBytes({ value: 120, units: "MiB" })).toBe(125829120);
    });

    it("converts 1 GiB to bytes", () => {
      expect(toBytes({ value: 1, units: "GiB" })).toBe(1073741824);
    });

    it("round-trips parse() → toBytes()", () => {
      expect(toBytes(usage.parse("120MiB"))).toBe(125829120);
    });
  });

  describe("simplify", () => {
    it("simplifies 1 GiB in bytes", () => {
      expect(usage.simplify(1073741824)).toEqual({ value: 1, units: "GiB" });
    });

    it("simplifies 1 MB in bytes", () => {
      expect(usage.simplify(1000000)).toEqual({ value: 1, units: "MB" });
    });

    it("simplifies 0 bytes to { value: 0, units: 'B' }", () => {
      expect(usage.simplify(0)).toEqual({ value: 0, units: "B" });
    });

    it("simplifies 500 bytes", () => {
      expect(usage.simplify(500)).toEqual({ value: 500, units: "B" });
    });

    it("simplifies 1 byte", () => {
      expect(usage.simplify(1)).toEqual({ value: 1, units: "B" });
    });
  });
});
