import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("responsive workspace styles", () => {
  it("lets the desktop case navigation scroll without clipping the rail footer", async () => {
    const css = await readFile(new URL("../../src/ui/styles.css", import.meta.url), "utf8");
    const desktopRules = css.slice(0, css.indexOf("@media (max-width: 1080px)"));

    expect(desktopRules).toMatch(/\.case-rail nav\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/);
  });

  it("allows the single-column workspace grid to shrink below navigation min-content", async () => {
    const css = await readFile(new URL("../../src/ui/styles.css", import.meta.url), "utf8");
    const tabletRules = css.match(/@media \(max-width: 900px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(tabletRules).toMatch(/\.workspace-shell\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
});
