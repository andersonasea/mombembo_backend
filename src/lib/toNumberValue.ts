/** Convertit les Decimal Prisma en nombres pour le JSON, sans casser les Date. */
export function toNumberValue<T>(value: T): T {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item) => toNumberValue(item)) as T;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    Object.entries(obj).forEach(([key, item]) => {
      if (item && typeof item === "object" && "toNumber" in (item as object)) {
        out[key] = Number(item as { toNumber: () => number });
      } else {
        out[key] = toNumberValue(item);
      }
    });
    return out as T;
  }
  return value;
}
