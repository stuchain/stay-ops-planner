// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { color } from "@/ui/tokens";

const css = readFileSync(path.resolve(__dirname, "../../../src/ui/theme.css"), "utf8").toLowerCase();

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

describe("theme.css matches tokens.ts", () => {
  it("has every light colour", () => {
    const light = block('[data-ui="new"]');
    for (const [name, value] of Object.entries(color.light)) {
      expect(light, name).toContain(`--so-${kebab(name)}: ${value.toLowerCase()};`);
    }
  });

  it("has every dark colour", () => {
    const dark = block('[data-ui="new"][data-theme="dark"]');
    for (const [name, value] of Object.entries(color.dark)) {
      expect(dark, name).toContain(`--so-${kebab(name)}: ${value.toLowerCase()};`);
    }
  });

  it("gives apartments no colours of their own", () => {
    expect(css).not.toMatch(/--(so-apt|color-(onar|cosmos|iris|helios))/);
  });

  it("follows the device in the system theme with the same dark colours", () => {
    const start = css.indexOf('[data-ui="new"][data-theme="system"] {');
    expect(start).toBeGreaterThan(css.indexOf("@media (prefers-color-scheme: dark)"));
    const system = css.slice(start, css.indexOf("}", start));
    for (const [name, value] of Object.entries(color.dark)) {
      expect(system, name).toContain(`--so-${kebab(name)}: ${value.toLowerCase()};`);
    }
  });
});
