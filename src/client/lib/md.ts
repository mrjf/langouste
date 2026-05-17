/**
 * Tiny, pragmatic Markdown → HTML renderer for chat text.
 *
 * Covers:
 *   - `**bold**`, `*italic*`, `` `code` ``
 *   - `[text](url)` links (http/https only, opened in new tab)
 *   - `#`, `##`, `###` headings
 *   - `-`, `*`, `+` unordered list items
 *   - `1.` ordered list items
 *   - `---` / `***` horizontal rules on their own line
 *   - Blank line → paragraph break; single newline → <br>
 *
 * NOT a full CommonMark implementation. No nested lists, no fenced code
 * blocks, no tables, no blockquotes, no reference-style links. If those show
 * up in Claude's output we fall back to line-preserving plain text with
 * inline formatting applied.
 *
 * Input is escaped before any tag substitution, so user / LLM text cannot
 * inject HTML. Links are validated to http(s)://… to prevent javascript:
 * URI tricks.
 */

const ESCAPE = /[&<>]/g;
const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

function escapeHtml(s: string): string {
  return s.replace(ESCAPE, (c) => ESCAPE_MAP[c]);
}

// Inline substitutions run after HTML escape, on per-line text. Order matters:
// code spans first so **stars** inside `` `code` `` aren't mangled.
function inline(s: string): string {
  return s
    .replace(/`([^`\n]+?)`/g, "<code>$1</code>")
    .replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "hr" };

const UL_RE = /^\s*[-*+]\s+(.+)$/;
const OL_RE = /^\s*\d+\.\s+(.+)$/;
const H_RE = /^(#{1,3})\s+(.+)$/;
const HR_RE = /^\s*(?:---+|\*\*\*+)\s*$/;

function parseBlocks(text: string): Block[] {
  const lines = text.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    const h = line.match(H_RE);
    if (h) {
      blocks.push({ kind: "h", level: h[1].length as 1 | 2 | 3, text: h[2] });
      i++;
      continue;
    }

    const ul = line.match(UL_RE);
    if (ul) {
      const items: string[] = [ul[1]];
      i++;
      while (i < lines.length) {
        const m = lines[i].match(UL_RE);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    const ol = line.match(OL_RE);
    if (ol) {
      const items: string[] = [ol[1]];
      i++;
      while (i < lines.length) {
        const m = lines[i].match(OL_RE);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    // Paragraph: absorb consecutive non-empty lines that aren't list/heading/hr.
    const para: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (
        next.trim() === "" ||
        HR_RE.test(next) ||
        H_RE.test(next) ||
        UL_RE.test(next) ||
        OL_RE.test(next)
      )
        break;
      para.push(next);
      i++;
    }
    blocks.push({ kind: "p", lines: para });
  }

  return blocks;
}

function renderBlock(b: Block): string {
  switch (b.kind) {
    case "hr":
      return "<hr>";
    case "h":
      return `<h${b.level}>${inline(b.text)}</h${b.level}>`;
    case "ul":
      return `<ul>${b.items.map((t) => `<li>${inline(t)}</li>`).join("")}</ul>`;
    case "ol":
      return `<ol>${b.items.map((t) => `<li>${inline(t)}</li>`).join("")}</ol>`;
    case "p":
      return `<p>${b.lines.map(inline).join("<br>")}</p>`;
  }
}

/**
 * Render a markdown string to safe HTML.
 */
export function md(source: string): string {
  if (!source) return "";
  const escaped = escapeHtml(source);
  const blocks = parseBlocks(escaped);
  return blocks.map(renderBlock).join("");
}

/**
 * Inline-only variant. Used where block elements would break layout
 * (e.g. the hint panel where each entry is a single line-wrapped span).
 */
export function mdInline(source: string): string {
  if (!source) return "";
  return inline(escapeHtml(source)).replace(/\n/g, "<br>");
}
