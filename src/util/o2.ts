const UNITS: Record<string, number> = { "": 1, k: 1_000, m: 1_000_000 };

/** Parses `8k`, `1.2M`, `1,2M` or a plain number into a token count. */
export function parseO2(value: string | number): number {
  if (typeof value === "number") return Math.round(value);
  const match = value
    .trim()
    .replace(",", ".")
    .match(/^(\d+(?:\.\d+)?)\s*([kKmM]?)$/);
  if (!match) throw new Error(`Invalid O₂ amount: "${value}"`);
  return Math.round(Number(match[1]) * UNITS[match[2].toLowerCase()]);
}

export function formatO2(tokens: number): string {
  if (tokens >= 1_000_000) return `${trimZeros((tokens / 1_000_000).toFixed(2))}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

/**
 * Rough token estimate (~4 chars per token). Good enough to rank and budget packs;
 * the provider returns the exact count once the call happens.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function trimZeros(decimal: string): string {
  return decimal.replace(/\.?0+$/, "").replace(".", ",");
}
