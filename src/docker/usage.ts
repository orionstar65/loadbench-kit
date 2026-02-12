/**
 * Lookup table mapping unit suffixes to their byte equivalents.
 *
 * Covers both SI decimal prefixes (kB, MB, GB, TB) and IEC binary prefixes
 * (KiB, MiB, GiB, TiB) as used by Docker CLI output.
 */
export const UnitsToBytes = {
  B: 1,
  // Decimal (SI) prefixes
  kB: 10 ** 3,
  MB: 10 ** 6,
  GB: 10 ** 9,
  TB: 10 ** 12,
  // Binary (IEC) prefixes
  KiB: 2 ** 10,
  MiB: 2 ** 20,
  GiB: 2 ** 30,
  TiB: 2 ** 40,
};

/** Union of all recognized unit suffix strings (e.g. `"MiB"`, `"GB"`). */
export type Units = keyof typeof UnitsToBytes;

const reUnits = Object.keys(UnitsToBytes).join("|");
const reFloat = "\\d+(\\.\\d+)?";
const reUsage = new RegExp(
  `^\\s*(?<value>${reFloat})\\s*(?<units>${reUnits})\\s*$`,
);

/**
 * A numeric value paired with its unit suffix.
 *
 * @property value - The numeric magnitude (e.g. `120`).
 * @property units - The unit suffix (e.g. `"MiB"`).
 */
export interface Usage {
  value: number;
  units: Units;
}

/**
 * Parse a human-readable size string (e.g. `"120.5MiB"`) into a structured
 * {@link Usage} object.
 *
 * @param s - The string to parse. Leading/trailing whitespace is tolerated.
 * @returns A `{ value, units }` object.
 * @throws {Error} If the string does not match `<float><unit>` format.
 */
function parse(s: string): Usage {
  const match = s.match(reUsage);
  const { value, units } = match?.groups ?? {};
  if (!(value && units)) throw new Error(`Invalid usage: ${s}`);
  return { value: Number(value), units: units as Units };
}

/**
 * Convert a {@link Usage} value to a different unit.
 *
 * @param usage - The source value and unit.
 * @param to    - The target unit suffix.
 * @returns A new {@link Usage} expressed in the target unit, rounded to two
 *          decimal places.
 */
function convert(usage: Usage, to: Units): Usage {
  const factor = UnitsToBytes[usage.units] / UnitsToBytes[to];
  return { value: Number((usage.value * factor).toFixed(2)), units: to };
}

/**
 * Convert a raw byte count into the largest unit where the value is >= 1.
 *
 * For example, `simplify(1_073_741_824)` returns `{ value: 1, units: "GiB" }`.
 *
 * @param bytes - An absolute byte count.
 * @returns A {@link Usage} in the most human-friendly unit, rounded to two
 *          decimal places. Returns `{ value: 0, units: "B" }` for zero or
 *          sub-byte inputs.
 */
function simplify(bytes: number): Usage {
  const sorted = Object.entries(UnitsToBytes).sort(([, a], [, b]) => b - a);
  for (const [units, factor] of sorted) {
    if (bytes >= factor)
      return {
        value: Number((bytes / factor).toFixed(2)),
        units: units as Units,
      };
  }
  return { value: 0, units: "B" as Units };
}

/**
 * Convert a {@link Usage} value to an absolute byte count.
 *
 * @param u - The value and unit to convert.
 * @returns The equivalent number of bytes as an integer.
 */
export function toBytes(u: Usage): number {
  return u.value * UnitsToBytes[u.units];
}

export default { parse, convert, simplify };
