import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// WCAG 2.1 SC 1.4.11: a graphic needed to understand the content (here, "no product image") needs
// at least 3:1 against its background. The placeholder sets both colours with theme tokens.

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
const css = readFileSync(path.join(SRC, "app", "globals.css"), "utf8");
const component = readFileSync(path.join(SRC, "components", "product-image.tsx"), "utf8");

function token(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!match) throw new Error(`no hex value for --${name} in globals.css`);
  return match[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("product image placeholder", () => {
  it("draws its icon at 3:1 or more against its background", () => {
    const placeholder = component.slice(component.indexOf("function Placeholder"), component.indexOf("export function"));
    const background = placeholder.match(/\bbg-([a-z-]+)/)?.[1];
    const icon = placeholder.match(/\btext-([a-z-]+)/)?.[1];
    expect(background).toBeDefined();
    expect(icon).toBeDefined();
    const ratio = contrast(token(background as string), token(icon as string));
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});
