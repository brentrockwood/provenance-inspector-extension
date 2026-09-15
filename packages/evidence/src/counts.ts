/**
 * Inspected-content counts.
 *
 * The panel reports these as exact figures, so the definition has to be fixed somewhere a
 * test can pin it. Words are whitespace-separated runs after trimming; characters are UTF-16
 * code units of the selection exactly as extracted, because that is what was digested.
 */

export interface ContentCounts {
  characters: number;
  words: number;
}

export function countContent(text: string): ContentCounts {
  const trimmed = text.trim();
  return {
    characters: text.length,
    words: trimmed.length === 0 ? 0 : trimmed.split(/\s+/u).length,
  };
}
