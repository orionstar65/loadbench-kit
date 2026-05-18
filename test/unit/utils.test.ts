import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { waitFor, percentile, mb } from "loadbench-kit/utils.js";

describe("percentile", () => {
  it("returns the median for a sorted array", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it("clamps high percentile to max element", () => {
    expect(percentile([10, 20, 30], 99)).toBe(30);
  });

  it("returns the only element for a single-element array", () => {
    expect(percentile([42], 50)).toBe(42);
  });

  it("handles unsorted input correctly", () => {
    // [3,1,4,1,5,9,2,6] sorted => [1,1,2,3,4,5,6,9]
    // p50: Math.ceil(0.5 * 8) - 1 = 3 => arr[3] = 3
    expect(percentile([3, 1, 4, 1, 5, 9, 2, 6], 50)).toBe(3);
  });

  it("handles reverse-sorted input correctly", () => {
    expect(percentile([5, 4, 3, 2, 1], 50)).toBe(3);
  });

  it("returns undefined for an empty array", () => {
    expect(percentile([], 50)).toBeUndefined();
  });
});

describe("mb", () => {
  it("formats 1 MiB correctly", () => {
    expect(mb(1048576)).toBe("1.0 MB");
  });

  it("formats zero bytes as KB", () => {
    expect(mb(0)).toBe("0.0 KB");
  });

  it("formats sub-MB values as KB", () => {
    expect(mb(512 * 1024)).toBe("512.0 KB");
  });

  it("returns N/A for NaN", () => {
    expect(mb(NaN)).toBe("N/A");
  });

  it("formats fractional megabytes", () => {
    expect(mb(1024 * 1024 * 2.5)).toBe("2.5 MB");
  });

  it("formats gigabyte values as GB", () => {
    expect(mb(1024 * 1024 * 1024 * 1.5)).toBe("1.50 GB");
  });
});

describe("waitFor", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("resolves when condition is true on first poll", async () => {
    const condition = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);

    const promise = waitFor(condition, 5000);

    await jest.advanceTimersByTimeAsync(100);

    await promise;

    expect(condition).toHaveBeenCalledTimes(1);
  });

  it("resolves when condition becomes true after a few polls", async () => {
    const condition = jest
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    const promise = waitFor(condition, 5000);

    await jest.advanceTimersByTimeAsync(300);

    await promise;

    expect(condition).toHaveBeenCalledTimes(3);
  });

  it("rejects with timeout message when condition never becomes true", async () => {
    const condition = jest
      .fn<() => Promise<boolean>>()
      .mockResolvedValue(false);

    const promise = waitFor(condition, 5000);

    // Catch the rejection to prevent unhandled rejection during timer advance
    const resultPromise = promise.catch((e: Error) => e);

    await jest.advanceTimersByTimeAsync(5000);

    const error = await resultPromise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Timeout waiting for condition");
  });

  it("respects custom timeout value", async () => {
    const condition = jest
      .fn<() => Promise<boolean>>()
      .mockResolvedValue(false);

    const promise = waitFor(condition, 1000);

    const resultPromise = promise.catch((e: Error) => e);

    await jest.advanceTimersByTimeAsync(1000);

    const error = await resultPromise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Timeout waiting for condition");

    // With a 1000ms timeout and 100ms interval, condition should have been
    // polled ~10 times (at 100, 200, ..., 1000ms) before timeout fires.
    expect(condition.mock.calls.length).toBeLessThanOrEqual(10);
    expect(condition.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("stops polling after condition resolves", async () => {
    const condition = jest
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    const promise = waitFor(condition, 5000);

    // Advance past the second poll to resolve
    await jest.advanceTimersByTimeAsync(200);
    await promise;

    const callCountAtResolve = condition.mock.calls.length;

    // Advance more time — condition should NOT be called again
    await jest.advanceTimersByTimeAsync(1000);

    expect(condition).toHaveBeenCalledTimes(callCountAtResolve);
  });
});
