import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("responsive workspace styles", () => {
  it("allows the single-column workspace grid to shrink below navigation min-content", async () => {
    const css = await readFile(new URL("../../src/ui/styles.css", import.meta.url), "utf8");
    const tabletRules = css.match(/@media \(max-width: 900px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(tabletRules).toMatch(/\.workspace-shell\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
});
