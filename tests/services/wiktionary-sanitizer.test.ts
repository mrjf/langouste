import { describe, expect, test } from "bun:test";
import { sanitizeWiktionaryHtml } from "../../src/services/references/item-reference.ts";

describe("sanitizeWiktionaryHtml", () => {
  test("removes script and noscript tags", () => {
    const out = sanitizeWiktionaryHtml(
      "<div>ok<script>evil()</script><noscript>x</noscript></div>",
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("evil()");
    expect(out).not.toContain("<noscript");
    expect(out).toContain("ok");
  });

  test("strips event handlers (quoted, unquoted, mixed case)", () => {
    const out = sanitizeWiktionaryHtml(
      `<span onclick="a()" onMouseOver='b()' onload=c()>hi</span>`,
    );
    expect(out.toLowerCase()).not.toContain("onclick");
    expect(out.toLowerCase()).not.toContain("onmouseover");
    expect(out.toLowerCase()).not.toContain("onload");
    expect(out).toContain("hi");
  });

  test("neutralizes javascript: and other non-http(s) URLs", () => {
    const out = sanitizeWiktionaryHtml(`<a href="javascript:alert(1)">x</a>`);
    expect(out.toLowerCase()).not.toContain("javascript:");
  });

  test("drops iframes, objects, images, and style", () => {
    const out = sanitizeWiktionaryHtml(
      `<div style="x"><iframe src="//evil"></iframe><object></object><img src="//t"></div>`,
    );
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("<object");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("style=");
  });

  test("preserves a benign conjugation table and absolutizes wiki links", () => {
    const out = sanitizeWiktionaryHtml(
      `<table class="inflection-table-collapsed"><tr><th>form</th><td><a href="/wiki/lenni">lenni</a></td></tr></table>`,
    );
    expect(out).toContain("<table");
    expect(out).toContain("<td");
    expect(out).toContain('href="https://en.wiktionary.org/wiki/lenni"');
    expect(out).toContain('rel="noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  test("expands collapsed inflection tables", () => {
    const out = sanitizeWiktionaryHtml(`<table class="inflection-table-collapsed"></table>`);
    expect(out).toContain("inflection-table-expanded");
    expect(out).not.toContain("inflection-table-collapsed");
  });
});
