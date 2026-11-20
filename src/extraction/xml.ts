/**
 * Minimal, dependency-free helpers for pulling *text* out of OOXML/ODF parts.
 * Deliberately not a general XML parser: every part read with these has a
 * known, flat-enough structure (paragraphs, runs, cells), and anything not
 * recognised just contributes its text or nothing. No DTDs, external
 * entities or includes are ever resolved, only the five predefined entities
 * and numeric character references.
 */

const NAMED_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1] === "x" || entity[1] === "X";
      const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Reads one attribute's (entity-decoded) value out of a tag's raw attribute string. */
export function attr(attributes: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attributes);
  return match ? decodeXmlEntities(match[1] ?? match[2] ?? "") : undefined;
}

export interface XmlElement {
  attributes: string;
  inner: string;
  /** The whole matched element, for callers that need to cut it out of its parent. */
  outer: string;
}

/**
 * Every `<tag …>…</tag>` / `<tag …/>` in document order. Assumes `tag`
 * doesn't nest inside itself (true for every element this is used on). A
 * longer tag sharing the prefix (`<a:p` vs `<a:pPr`) never matches.
 */
export function elements(xml: string, tag: string): XmlElement[] {
  const t = escapeRegExp(tag);
  const re = new RegExp(`<${t}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</${t}>)`, "g");
  const found: XmlElement[] = [];
  for (const match of xml.matchAll(re)) {
    found.push({ attributes: match[1] ?? "", inner: match[2] ?? "", outer: match[0] });
  }
  return found;
}

export function stripTags(xml: string): string {
  return xml.replace(/<[^>]*>/g, "");
}

/**
 * Resolves a relationship `Target` against the folder of the part that owns
 * the `.rels` file (`"ppt/slides"` + `"../notesSlides/n1.xml"` gives
 * `"ppt/notesSlides/n1.xml"`). Absolute targets are package-root relative.
 */
export function resolvePartPath(baseDir: string, target: string): string {
  const parts = target.startsWith("/") ? [] : baseDir.split("/").filter(Boolean);
  for (const segment of target.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

/** `Id` → resolved part path (and relationship type), from an OPC `.rels` part. External targets are ignored. */
export function readRelationships(
  relsXml: string | undefined,
  baseDir: string,
): Map<string, { target: string; type: string }> {
  const rels = new Map<string, { target: string; type: string }>();
  if (!relsXml) return rels;
  for (const rel of elements(relsXml, "Relationship")) {
    const id = attr(rel.attributes, "Id");
    const target = attr(rel.attributes, "Target");
    if (!id || !target || attr(rel.attributes, "TargetMode") === "External") continue;
    rels.set(id, { target: resolvePartPath(baseDir, target), type: attr(rel.attributes, "Type") ?? "" });
  }
  return rels;
}

/** Text of one ODF paragraph/heading body: spaces, tabs and line breaks kept; footnotes and comments dropped. */
export function odfInlineText(inner: string): string {
  const expanded = inner
    .replace(/<text:note\b[\s\S]*?<\/text:note>/g, "")
    .replace(/<office:annotation\b[\s\S]*?<\/office:annotation>/g, "")
    .replace(/<text:s(\s[^>]*?)?\/>/g, (_match, attributes: string | undefined) => {
      const count = Number(attr(attributes ?? "", "text:c") ?? "1");
      return " ".repeat(Number.isInteger(count) && count > 0 ? Math.min(count, 100) : 1);
    })
    .replace(/<text:tab(\s[^>]*?)?\/>/g, "\t")
    .replace(/<text:line-break(\s[^>]*?)?\/>/g, "\n");
  return decodeXmlEntities(stripTags(expanded));
}
