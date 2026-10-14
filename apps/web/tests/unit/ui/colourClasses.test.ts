// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * theme.css resets Tailwind's colours (`--color-*: initial`), so a class like `text-black` or `text-danger-text`
 * silently draws nothing. This fails on any colour class whose name is not a colour defined in theme.css.
 */
const src = path.resolve(__dirname, "../../../src");
const css = readFileSync(path.join(src, "ui/theme.css"), "utf8");
const colours = new Set([...css.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]!));

/** Utility suffixes that share a prefix with colour utilities but are not colours. */
const NOT_COLOURS = new Set([
  "inherit",
  // text-*
  "xs",
  "sm",
  "base",
  "lg",
  "xl",
  "2xl",
  "left",
  "right",
  "center",
  "start",
  "end",
  "justify",
  "wrap",
  "nowrap",
  "balance",
  "pretty",
  "ellipsis",
  "clip",
  // border-*, outline-*, ring-*, divide-*, decoration-*
  "0",
  "1",
  "2",
  "4",
  "6",
  "8",
  "t",
  "b",
  "l",
  "r",
  "x",
  "y",
  "s",
  "e",
  "solid",
  "dashed",
  "dotted",
  "double",
  "none",
  "hidden",
  "collapse",
  "separate",
  "inset",
  "offset",
  // bg-*
  "fixed",
  "local",
  "scroll",
  "cover",
  "contain",
  "auto",
  "no-repeat",
  "repeat",
  "center",
  "top",
  "bottom",
  "linear-to-r",
  "linear-to-b",
  "clip-text",
  "origin-border",
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

const CLASS =
  /(?<![\w-])(?:[a-z0-9-]+:)*(?:text|bg|border(?:-[trblxyse])?|ring|fill|stroke|outline|divide|decoration|placeholder|caret|accent)-([a-z][a-z0-9-]*)(?:\/\d+)?(?![\w[-])/g;

describe("colour classes", () => {
  it("only use colours defined in theme.css", () => {
    const unknown: string[] = [];
    for (const file of [...files(path.join(src, "features")), ...files(path.join(src, "ui"))]) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(CLASS)) {
        const name = m[1]!;
        // Side widths like border-b-2 match as border + "b-2"; border-spacing-* is not a colour.
        if (NOT_COLOURS.has(name) || colours.has(name) || /^([trblxyse](-\d+)?|spacing-.+)$/.test(name)) continue;
        unknown.push(`${path.relative(src, file)}: ${m[0]}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});
