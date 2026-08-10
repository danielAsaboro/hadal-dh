import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("responsive workspace styles", () => {
  it("keeps the desktop application rail stable beside a shrinkable content column", async () => {
    const css = await readFile(new URL("../../src/ui/styles.css", import.meta.url), "utf8");
    const desktopRules = css.slice(0, css.indexOf("@media (max-width: 1080px)"));

    expect(desktopRules).toMatch(/\.workspace-shell\s*\{[^}]*grid-template-columns:\s*238px\s+minmax\(0,\s*1fr\)/);
    expect(desktopRules).toMatch(/\.app-rail\s*\{[^}]*position:\s*sticky[^}]*height:\s*calc\(100vh\s*-\s*40px\)/);
    expect(desktopRules).toMatch(/\.workspace-context\s*\{[^}]*min-height:\s*64px/);
    expect(desktopRules).toMatch(/\.case-picker-results\s*\{[^}]*max-height:\s*min\([^;]+;[^}]*overflow-y:\s*auto[^}]*overscroll-behavior:\s*contain/);
  });

  it("uses an in-flow collapsible mobile menu without nested miniature scroll areas", async () => {
    const css = await readFile(new URL("../../src/ui/styles.css", import.meta.url), "utf8");
    const tabletRules = css.match(/@media \(max-width: 900px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(tabletRules).toMatch(/\.workspace-shell\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(tabletRules).toMatch(/\.app-rail\s*\{[^}]*display:\s*none/);
    expect(tabletRules).toMatch(/\.mobile-workspace-menu\s*\{[^}]*display:\s*block[^}]*position:\s*static/);
    expect(tabletRules).toMatch(/\.mobile-workspace-menu nav\s*\{[^}]*display:\s*grid[^}]*overflow:\s*visible/);
    expect(tabletRules).not.toMatch(/\.mobile-workspace-menu nav\s*\{[^}]*overflow-[xy]:\s*(auto|scroll)/);
    expect(tabletRules).toMatch(/\.case-picker-results\s*\{[^}]*position:\s*static[^}]*max-height:\s*none[^}]*overflow:\s*visible/);
  });
});
