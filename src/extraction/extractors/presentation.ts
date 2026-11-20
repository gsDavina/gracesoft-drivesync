import type { Unzipped } from "fflate";
import type { ArchiveLimits, Extractor } from "../types.js";
import { attr, decodeXmlEntities, elements, odfInlineText, readRelationships } from "../xml.js";
import { entryText, readZip, requireEntryText } from "../zip.js";
import { assertOdfNotEncrypted } from "./spreadsheet.js";

export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const ODP_MIME = "application/vnd.oasis.opendocument.presentation";
export const ODT_MIME = "application/vnd.oasis.opendocument.text";

export interface Slide {
  title?: string;
  paragraphs: string[];
  notes: string[];
}

const NOTES_SLIDE_REL_TYPE = /\/notesSlide$/;
const TITLE_PLACEHOLDER = /<p:ph\b[^>]*\btype\s*=\s*"(?:title|ctrTitle)"/;
const BODY_PLACEHOLDER = /<p:ph\b[^>]*\btype\s*=\s*"body"/;

/** DrawingML paragraphs (`<a:p>`) → text, one entry per non-empty paragraph. */
function drawingParagraphs(xml: string): string[] {
  return elements(xml, "a:p")
    .map((p) =>
      elements(p.inner.replace(/<a:br(\s[^>]*?)?\/>/g, "<a:t>\n</a:t>"), "a:t")
        .map((t) => decodeXmlEntities(t.inner))
        .join("")
        .trim(),
    )
    .filter(Boolean);
}

function dirOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

/**
 * Slides of a pptx in presentation order (`p:sldIdLst`, not file-name
 * order). The title placeholder becomes the slide's title; speaker notes
 * (the notes slide's body placeholder) are kept because they often hold the
 * narrative the slides only outline.
 */
export function parsePptx(entries: Unzipped): Slide[] {
  const presentation = requireEntryText(entries, "ppt/presentation.xml");
  const rels = readRelationships(entryText(entries, "ppt/_rels/presentation.xml.rels"), "ppt");

  const slides: Slide[] = [];
  for (const slideId of elements(presentation, "p:sldId")) {
    const relId = attr(slideId.attributes, "r:id");
    const path = relId ? rels.get(relId)?.target : undefined;
    const xml = path ? entryText(entries, path) : undefined;
    if (!path || !xml) continue;

    let title: string | undefined;
    let body = xml;
    const titleShape = elements(xml, "p:sp").find((sp) => TITLE_PLACEHOLDER.test(sp.inner));
    if (titleShape) {
      title = drawingParagraphs(titleShape.inner).join(" ").replace(/\s+/g, " ").trim() || undefined;
      body = xml.replace(titleShape.outer, "");
    }

    const slideFile = path.slice(path.lastIndexOf("/") + 1);
    const slideRels = readRelationships(entryText(entries, `${dirOf(path)}/_rels/${slideFile}.rels`), dirOf(path));
    const notesPath = [...slideRels.values()].find((rel) => NOTES_SLIDE_REL_TYPE.test(rel.type))?.target;
    const notesXml = notesPath ? entryText(entries, notesPath) : undefined;
    const notes = notesXml
      ? elements(notesXml, "p:sp")
          .filter((sp) => BODY_PLACEHOLDER.test(sp.inner))
          .flatMap((sp) => drawingParagraphs(sp.inner))
      : [];

    slides.push({ title, paragraphs: drawingParagraphs(body), notes });
  }
  return slides;
}

/** Pages of an ODF presentation's `content.xml`, with the title frame and speaker notes split out. */
export function parseOdpContent(content: string): Slide[] {
  return elements(content, "draw:page").map((page) => {
    let body = page.inner;
    const notesBlock = elements(body, "presentation:notes")[0];
    if (notesBlock) body = body.replace(notesBlock.outer, "");

    let title: string | undefined;
    const titleFrame = elements(body, "draw:frame").find((f) => attr(f.attributes, "presentation:class") === "title");
    if (titleFrame) {
      title = odfParagraphs(titleFrame.inner).join(" ").replace(/\s+/g, " ").trim() || undefined;
      body = body.replace(titleFrame.outer, "");
    }

    return { title, paragraphs: odfParagraphs(body), notes: notesBlock ? odfParagraphs(notesBlock.inner) : [] };
  });
}

/** Every ODF `<text:p>`/`<text:h>` → trimmed text, in document order. */
function odfParagraphs(xml: string): string[] {
  const re = /<text:(p|h)(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/text:\1>)/g;
  return [...xml.matchAll(re)].map((m) => odfInlineText(m[3] ?? "").trim()).filter(Boolean);
}

/** `## Slide N: <title>`, the slide's text, then its speaker notes. Slides with no text at all are left out. */
export function renderSlides(slides: Slide[]): string {
  return slides
    .map((slide, i) => {
      if (!slide.title && slide.paragraphs.length === 0 && slide.notes.length === 0) return "";
      const heading = slide.title ? `## Slide ${i + 1}: ${slide.title}` : `## Slide ${i + 1}`;
      const notes = slide.notes.length > 0 ? [`Speaker notes:\n${slide.notes.join("\n")}`] : [];
      return [heading, ...slide.paragraphs, ...notes].join("\n\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * ODF text document body → paragraphs, with `<text:h>` headings rendered as
 * Markdown `#` headings at their outline level. Footnotes, comments and
 * tracked-change deletions are dropped (they aren't the document's visible
 * body text).
 */
export function parseOdtContent(content: string): string {
  const body = (/<office:text\b[^>]*>([\s\S]*)<\/office:text>/.exec(content)?.[1] ?? "")
    .replace(/<text:tracked-changes\b[\s\S]*?<\/text:tracked-changes>/g, "")
    .replace(/<text:note\b[\s\S]*?<\/text:note>/g, "")
    .replace(/<office:annotation\b[\s\S]*?<\/office:annotation>/g, "");

  const re = /<text:(p|h)(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/text:\1>)/g;
  const blocks: string[] = [];
  for (const match of body.matchAll(re)) {
    const text = odfInlineText(match[3] ?? "").trim();
    if (!text) continue;
    if (match[1] === "h") {
      const level = Math.min(Math.max(Number(attr(match[2] ?? "", "text:outline-level") ?? "1") || 1, 1), 6);
      blocks.push(`${"#".repeat(level)} ${text.replace(/\s+/g, " ")}`);
    } else {
      blocks.push(text);
    }
  }
  return blocks.join("\n\n");
}

function odfEntries(buffer: Uint8Array, limits: ArchiveLimits): Unzipped {
  const entries = readZip(buffer, limits, (name) => name === "content.xml" || name === "META-INF/manifest.xml");
  assertOdfNotEncrypted(entries);
  return entries;
}

/** `.pptx` and `.odp` (M25). Legacy `.ppt` is deferred. */
export function createPresentationExtractor(): Extractor {
  return {
    name: "presentation",
    mimeTypes: [PPTX_MIME, ODP_MIME],
    async extract(file, { driveClient, archiveLimits }) {
      const buffer = await driveClient.downloadFile(file.id);
      if (file.mimeType === ODP_MIME) {
        const entries = odfEntries(buffer, archiveLimits);
        return { ok: true, text: renderSlides(parseOdpContent(requireEntryText(entries, "content.xml"))) };
      }
      const entries = readZip(buffer, archiveLimits, (name) => name.startsWith("ppt/") && (name.endsWith(".xml") || name.endsWith(".rels")));
      return { ok: true, text: renderSlides(parsePptx(entries)) };
    },
  };
}

/** `.odt` (M25). */
export function createOdtExtractor(): Extractor {
  return {
    name: "odt",
    mimeTypes: [ODT_MIME],
    async extract(file, { driveClient, archiveLimits }) {
      const entries = odfEntries(await driveClient.downloadFile(file.id), archiveLimits);
      return { ok: true, text: parseOdtContent(requireEntryText(entries, "content.xml")) };
    },
  };
}
