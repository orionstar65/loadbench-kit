# Generators

Generators produce infinite (or finite) sequences of values used to build `Tier`
arrays for performance test runs. They follow the iterator protocol and are
consumed with the `n()` helper.

All generators are exported from `loadbench-kit/generators.js`.

---

## `n(count, generator)`

The primary way to consume any generator. Takes `count` values from a generator
and returns them as an array.

```typescript
import { n, exponential } from "loadbench-kit/generators.js";

const values = n(5, exponential(2));
// [1, 2, 4, 8, 16]
```

Because most generators are infinite, `n()` is the standard mechanism for
extracting a fixed-length sequence. It calls `generator.next()` exactly `count`
times and collects the results.

---

## `exponential(base)`

Infinite generator yielding `base^0`, `base^1`, `base^2`, and so on.

```typescript
import { n, exponential } from "loadbench-kit/generators.js";

n(5, exponential(2));
// [1, 2, 4, 8, 16]

n(4, exponential(3));
// [1, 3, 9, 27]
```

Useful for concurrency levels that scale geometrically, stressing the system at
progressively larger multiples.

---

## `linear(m, b)`

Infinite generator yielding `m * 0 + b`, `m * 1 + b`, `m * 2 + b`, and so on.
`m` is the slope and `b` is the y-intercept.

```typescript
import { n, linear } from "loadbench-kit/generators.js";

n(4, linear(10, 5));
// [5, 15, 25, 35]

n(5, linear(100, 100));
// [100, 200, 300, 400, 500]
```

Useful for uniform step increases in concurrency or message count.

---

## `constant(c)`

Infinite generator that always yields the same value.

```typescript
import { n, constant } from "loadbench-kit/generators.js";

n(3, constant(1000));
// [1000, 1000, 1000]

n(4, constant("warm-up"));
// ["warm-up", "warm-up", "warm-up", "warm-up"]
```

Useful for holding one dimension fixed (such as message count) while another
dimension varies.

---

## `range(start, end, step)`

Finite generator yielding values from `start` to `end` (inclusive), incrementing
by `step`.

```typescript
import { n, range } from "loadbench-kit/generators.js";

n(5, range(1, 5, 1));
// [1, 2, 3, 4, 5]

n(3, range(10, 30, 10));
// [10, 20, 30]
```

Unlike the infinite generators, `range` terminates on its own when it exceeds
`end`. Passing a `count` to `n()` that exceeds the range length will produce
`undefined` values for the excess entries.

---

## `composite(obj)`

Combines multiple generators into a single generator that yields objects. Each
key in the input record maps to a generator. On each iteration, `composite`
consumes one value from every generator and assembles them into a single object.

```typescript
import {
  composite,
  exponential,
  constant,
  n,
} from "loadbench-kit/generators.js";

const gen = composite({
  concurrency: exponential(2),
  count: constant(500),
});

n(3, gen);
// [
//   { concurrency: 1, count: 500 },
//   { concurrency: 2, count: 500 },
//   { concurrency: 4, count: 500 },
// ]
```

The combined generator is infinite as long as at least one of its constituent
generators is infinite. If any constituent generator is finite (such as
`range`), the composite will yield `undefined` for that key once it is
exhausted.

---

## Building Tiers

The main use case for generators is constructing `Tier[]` arrays for the runner.
A `Tier` has three fields:

```typescript
interface Tier {
  name: string;
  concurrency: number;
  count: number;
}
```

Use `composite` to combine a generator for each field, then `n` to materialize
the array:

```typescript
import {
  n,
  composite,
  exponential,
  linear,
  constant,
} from "loadbench-kit/generators.js";
import type { Tier } from "loadbench-kit/runner.js";

const tiers: Tier[] = n(
  5,
  composite({
    name: linear(1, 1), // 1, 2, 3, 4, 5 (used as tier labels)
    concurrency: exponential(2), // 1, 2, 4, 8, 16
    count: constant(1000), // 1000 messages per tier
  }),
) as Tier[];
```

This produces:

```typescript
[
  { name: 1, concurrency: 1, count: 1000 },
  { name: 2, concurrency: 2, count: 1000 },
  { name: 3, concurrency: 4, count: 1000 },
  { name: 4, concurrency: 8, count: 1000 },
  { name: 5, concurrency: 16, count: 1000 },
];
```

If you need string names, map over the result or use a custom generator.

---

## Usage Examples

### Exponential concurrency ramp

```typescript
import { n, exponential } from "loadbench-kit/generators.js";

const concurrencyLevels = n(5, exponential(2));
// [1, 2, 4, 8, 16]
```

### Linear ramp-up with range

```typescript
import { n, range } from "loadbench-kit/generators.js";

const steps = n(5, range(10, 50, 10));
// [10, 20, 30, 40, 50]
```

### Composite tier builder

```typescript
import {
  n,
  composite,
  exponential,
  constant,
  linear,
} from "loadbench-kit/generators.js";

const tiers = n(
  4,
  composite({
    name: linear(1, 1),
    concurrency: exponential(2),
    count: constant(500),
  }),
);
// [
//   { name: 1, concurrency: 1, count: 500 },
//   { name: 2, concurrency: 2, count: 500 },
//   { name: 3, concurrency: 4, count: 500 },
//   { name: 4, concurrency: 8, count: 500 },
// ]
```

### Complete test suite tier sequence

```typescript
import {
  n,
  composite,
  exponential,
  linear,
  constant,
  range,
} from "loadbench-kit/generators.js";
import type { Tier } from "loadbench-kit/runner.js";

// Warm-up: 3 tiers at low concurrency with increasing message counts
const warmup: Tier[] = n(
  3,
  composite({
    name: constant("warmup"),
    concurrency: constant(1),
    count: range(100, 300, 100),
  }),
) as Tier[];

// Load test: 6 tiers with exponentially increasing concurrency
const load: Tier[] = n(
  6,
  composite({
    name: constant("load"),
    concurrency: exponential(2),
    count: constant(1000),
  }),
) as Tier[];

// Combine into a single tier sequence
const tiers: Tier[] = [...warmup, ...load];
```

This produces a 9-tier sequence: three warm-up tiers at concurrency 1 with 100,
200, and 300 messages, followed by six load tiers at concurrency 1, 2, 4, 8, 16,
and 32 with 1000 messages each.
