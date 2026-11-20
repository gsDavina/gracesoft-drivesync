import { convert } from "html-to-text";
import type { FormatCallback, SelectorDefinition } from "html-to-text";

/** `<h1>`–`<h6>` become `#`–`######` paragraphs, which M6's chunker treats as real section headings. */
const markdownHeading: FormatCallback = (elem, walk, builder) => {
  const level = Number(/^h([1-6])$/i.exec(elem.name ?? "")?.[1] ?? "1");
  builder.openBlock({ leadingLineBreaks: 2 });
  builder.addLiteral(`${"#".repeat(level)} `);
  walk(elem.children, builder);
  builder.closeBlock({ trailingLineBreaks: 2 });
};

const SELECTORS: SelectorDefinition[] = [
  ...["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({ selector, format: "markdownHeading" })),
  // Only text is indexed: link targets, images and anything executable or
  // invisible are dropped, never fetched or run.
  { selector: "a", options: { ignoreHref: true } },
  { selector: "img", format: "skip" },
  { selector: "script", format: "skip" },
  { selector: "style", format: "skip" },
  { selector: "noscript", format: "skip" },
  { selector: "template", format: "skip" },
  { selector: "iframe", format: "skip" },
  { selector: "table", format: "dataTable" },
];

/**
 * HTML → readable plain text with Markdown headings. Shared by the HTML
 * extractor (M23) and the docx extractor (M22, via mammoth's HTML output).
 */
export function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    formatters: { markdownHeading },
    selectors: SELECTORS,
  }).trim();
}
