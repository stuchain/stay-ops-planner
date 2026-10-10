import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { DOMAIN_ERROR_CODES } from "@stay-ops/domain";
import el from "../../../messages/el.json";
import en from "../../../messages/en.json";

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === "string") out.set(prefix + key, value);
    else for (const [k, v] of leaves(value, `${prefix}${key}.`)) out.set(k, v);
  }
  return out;
}

const elLeaves = leaves(el as Tree);
const enLeaves = leaves(en as Tree);

describe("message files", () => {
  it("have the same keys in Greek and English", () => {
    expect([...elLeaves.keys()].sort()).toEqual([...enLeaves.keys()].sort());
  });

  it("have no empty messages", () => {
    for (const [key, value] of [...elLeaves, ...enLeaves]) expect(value.trim(), key).not.toBe("");
  });

  it("use the same placeholders in both languages", () => {
    const names = (m: string) => [...m.matchAll(/\{([a-z]\w*)[,}]/g)].map((x) => x[1]).sort();
    for (const [key, value] of elLeaves) expect(names(enLeaves.get(key) ?? ""), key).toEqual(names(value));
  });

  it("translate every error code", () => {
    for (const code of [...DOMAIN_ERROR_CODES, "NETWORK"]) {
      expect(elLeaves.has(`errors.${code}`), code).toBe(true);
    }
  });

  it("say 1 νύχτα / 3 νύχτες and 1 άτομο / 4 άτομα", () => {
    const t = createTranslator({ locale: "el", messages: el });
    expect(t("common.nights", { count: 1 })).toBe("1 νύχτα");
    expect(t("common.nights", { count: 3 })).toBe("3 νύχτες");
    expect(t("common.people", { count: 1 })).toBe("1 άτομο");
    expect(t("common.people", { count: 4 })).toBe("4 άτομα");
    const tEn = createTranslator({ locale: "en", messages: en });
    expect(tEn("common.nights", { count: 1 })).toBe("1 night");
    expect(tEn("common.people", { count: 4 })).toBe("4 people");
  });
});

/** Greek letters in new-UI source outside comments: text that should live in the message files. */
function hardCodedGreek(file: string): string[] {
  const source = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  return source.split("\n").filter((line) => /[Ͱ-Ͽἀ-῿]/.test(line));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("new screens", () => {
  const root = path.resolve(__dirname, "../../../src");
  // format.ts holds locale data (Greek month abbreviations), not screen text.
  const files = [...sourceFiles(path.join(root, "features")), ...sourceFiles(path.join(root, "ui"))].filter(
    (f) => !f.endsWith(path.join("ui", "format.ts")),
  );

  it.each(files.map((f) => [path.relative(root, f), f]))("%s has no text outside the message files", (_, file) => {
    expect(hardCodedGreek(file)).toEqual([]);
  });
});
