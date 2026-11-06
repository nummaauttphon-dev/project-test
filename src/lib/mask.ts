const segmenter = new Intl.Segmenter("th", { granularity: "grapheme" });

function firstGrapheme(word: string): string {
  for (const { segment } of segmenter.segment(word)) return segment;
  return "";
}

/** Keeps only the first character of each word: "สมชาย ใจดี" -> "ส*** ใ***". */
export function maskName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${firstGrapheme(word)}***`)
    .join(" ");
}

/** Hides the address, keeping only a 5-digit postal code if present. */
export function maskAddress(address: string): string {
  const matches = address.match(/(?<!\d)\d{5}(?!\d)/g);
  const postal = matches?.[matches.length - 1];
  return postal ? `••• ${postal}` : "•••";
}
