import { describe, it, expect } from "@jest/globals";
import {
  exponential,
  linear,
  constant,
  range,
  composite,
  n,
} from "loadbench-kit/generators.js";

describe("exponential", () => {
  it("yields successive powers of 2", () => {
    expect(n(5, exponential(2))).toEqual([1, 2, 4, 8, 16]);
  });

  it("yields successive powers of 3", () => {
    expect(n(4, exponential(3))).toEqual([1, 3, 9, 27]);
  });

  it("yields 1 then zeros for base 0 (0^0=1)", () => {
    expect(n(4, exponential(0))).toEqual([1, 0, 0, 0]);
  });
});

describe("linear", () => {
  it("yields m*i + b with b=0", () => {
    expect(n(4, linear(5, 0))).toEqual([0, 5, 10, 15]);
  });

  it("yields constant value when m=0", () => {
    expect(n(3, linear(0, 42))).toEqual([42, 42, 42]);
  });

  it("yields m*i + b with both nonzero", () => {
    expect(n(4, linear(2, 3))).toEqual([3, 5, 7, 9]);
  });
});

describe("constant", () => {
  it("yields the same number repeatedly", () => {
    expect(n(3, constant(42))).toEqual([42, 42, 42]);
  });

  it("yields the same string repeatedly", () => {
    expect(n(2, constant("hello"))).toEqual(["hello", "hello"]);
  });
});

describe("range", () => {
  it("yields inclusive start and end with step 2", () => {
    expect(n(6, range(0, 10, 2))).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it("yields single value when start equals end", () => {
    expect(n(1, range(5, 5, 1))).toEqual([5]);
  });

  it("yields start when step exceeds range", () => {
    expect(n(1, range(0, 10, 20))).toEqual([0]);
  });
});

describe("composite", () => {
  it("yields records combining multiple generators", () => {
    const gen = composite({
      a: linear(1, 0),
      b: exponential(2),
      c: constant(3),
    });
    const results = n(3, gen);
    expect(results).toEqual([
      { a: 0, b: 1, c: 3 },
      { a: 1, b: 2, c: 3 },
      { a: 2, b: 4, c: 3 },
    ]);
  });

  it("produces typed output when given a generic parameter", () => {
    interface Tier {
      name: string;
      concurrency: number;
      count: number;
    }
    const gen = composite<Tier>({
      name: constant("t"),
      concurrency: linear(1, 1),
      count: constant(10),
    });
    const [first] = n(1, gen);
    expect(first.name).toBe("t");
    expect(first.concurrency).toBe(1);
    expect(first.count).toBe(10);
  });

  it("advances each field generator independently (lock-step)", () => {
    interface Tier {
      name: string;
      concurrency: number;
      count: number;
    }
    const gen = composite<Tier>({
      name: constant("ramp"),
      concurrency: exponential(2),
      count: linear(100, 100),
    });
    const results = n(3, gen);
    expect(results).toEqual([
      { name: "ramp", concurrency: 1, count: 100 },
      { name: "ramp", concurrency: 2, count: 200 },
      { name: "ramp", concurrency: 4, count: 300 },
    ]);
  });
});

describe("n", () => {
  it("takes the specified number of values", () => {
    expect(n(3, linear(5, 0))).toEqual([0, 5, 10]);
  });

  it("returns empty array for n=0", () => {
    expect(n(0, linear(1, 0))).toEqual([]);
  });
});
