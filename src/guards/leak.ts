const SHINGLE_SIZE = 6;

/**
 * Leak guard: a FALL call must describe behaviour, never quote the sealed tests.
 * Compares runs of `n` consecutive words (shingles) between the message and the sealed code
 * and returns the ones they share.
 */
export function findLeaks(message: string, sealedCode: string, n = SHINGLE_SIZE): string[] {
  const sealed = new Set(shingles(words(sealedCode), n));
  const leaks: string[] = [];
  for (const shingle of shingles(words(message), n)) {
    if (sealed.has(shingle) && !leaks.includes(shingle)) leaks.push(shingle);
  }
  return leaks;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_$]+/u)
    .filter(Boolean);
}

function shingles(list: string[], n: number): string[] {
  const result: string[] = [];
  for (let i = 0; i + n <= list.length; i++) result.push(list.slice(i, i + n).join(" "));
  return result;
}
