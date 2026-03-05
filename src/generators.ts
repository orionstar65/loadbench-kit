/**
 * Yield successive powers of `base`: base^0, base^1, base^2, ...
 *
 * @param base - The base of the exponential sequence.
 * @returns An infinite generator of numbers.
 *
 * @example
 * // exponential(2) => 1, 2, 4, 8, 16, ...
 */
export function* exponential(base: number): Generator<number> {
  let i = -1;
  while (true) yield Math.pow(base, ++i);
}

/**
 * Yield a linear sequence: b, m+b, 2m+b, 3m+b, ...
 *
 * @param m - Slope (increment per step).
 * @param b - Y-intercept (starting value).
 * @returns An infinite generator of numbers.
 *
 * @example
 * // linear(10, 5) => 5, 15, 25, 35, ...
 */
export function* linear(m: number, b: number): Generator<number> {
  let i = -1;
  while (true) yield m * ++i + b;
}

/**
 * Yield the same value forever.
 *
 * @param c - The constant value to emit.
 * @returns An infinite generator that always yields `c`.
 *
 * @example
 * // constant("hello") => "hello", "hello", "hello", ...
 */
export function* constant<T>(c: T): Generator<T> {
  while (true) yield c;
}

/**
 * Yield numbers from `start` to `end` (inclusive) stepping by `step`.
 *
 * Unlike the infinite generators, this terminates when `end` is exceeded.
 *
 * @param start - First value in the range.
 * @param end   - Upper bound (inclusive).
 * @param step  - Increment between successive values.
 * @returns A finite generator of numbers.
 *
 * @example
 * // range(0, 10, 5) => 0, 5, 10
 */
export function* range(
  start: number,
  end: number,
  step: number,
): Generator<number> {
  for (let i = start; i <= end; i += step) yield i;
}

/**
 * Combine multiple named generators into a single generator that yields
 * objects whose keys advance their respective generators in lock-step.
 *
 * @param obj - A record mapping property names to generators.
 * @returns An infinite generator of plain objects.
 *
 * @example
 * // composite({ x: linear(1, 0), y: constant(5) })
 * // => { x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }, ...
 */
export function* composite<T extends object = Record<string, unknown>>(obj: {
  [K in keyof T]: Generator<T[K]>;
}): Generator<T> {
  const keys = Object.keys(obj) as (keyof T & string)[];
  while (true) {
    yield Object.fromEntries(
      keys.map((key) => [key, obj[key].next().value]),
    ) as T;
  }
}

/**
 * Consume the next `i` values from a generator and return them as an array.
 *
 * @param i         - Number of values to take.
 * @param generator - The generator to consume from.
 * @returns An array of `i` values.
 *
 * @example
 * // n(3, exponential(2)) => [1, 2, 4]
 */
export function n<T>(i: number, generator: Generator<T>): T[] {
  return Array.from({ length: i }, () => generator.next().value);
}

export default {
  exponential,
  linear,
  constant,
  range,
  composite,
  n,
};
