import { describe, expect, it, vi } from "vitest";
import { chunkText } from "../../chunking/chunkText.js";
import type { Tokenizer } from "../../chunking/chunkText.js";
import { driveFile, fakeDriveClient, xlsxOf, zipOf } from "../fixtures.testutil.js";
import { createTextExtractor } from "../textExtractor.js";
import type { DocTextReader, DocxConverter } from "./word.js";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ODS = "application/vnd.oasis.opendocument.spreadsheet";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const ODP = "application/vnd.oasis.opendocument.presentation";
const ODT = "application/vnd.oasis.opendocument.text";

function extractorFor(
  download: Buffer,
  opts: { docxConverter?: DocxConverter; docTextReader?: DocTextReader } = {},
) {
  const driveClient = fakeDriveClient(download);
  return { driveClient, textExtractor: createTextExtractor({ driveClient, pdfParser: { parse: vi.fn() }, ...opts }) };
}

/** Whitespace tokenizer: good enough to drive chunkText end-to-end in tests. */
const wordTokenizer: Tokenizer = {
  encode: (text) => Array.from(text).map((ch) => ch.charCodeAt(0)),
  decode: (tokens) => String.fromCharCode(...tokens),
};

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2, 3]);

// A minimal real docx (with styles, so mammoth maps Heading1/Heading2).
const DOCX_FIXTURE = zipOf({
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  "word/styles.xml": `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`,
  "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quarterly report</w:t></w:r></w:p>
    <w:p><w:r><w:t>Revenue grew &amp; costs fell.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Outlook</w:t></w:r></w:p>
    <w:p><w:r><w:t>Cautiously optimistic.</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Sales</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body></w:document>`,
});

describe("docx (M22, real mammoth)", () => {
  it("turns Word heading styles into Markdown headings and keeps body and table text", async () => {
    const { textExtractor } = extractorFor(DOCX_FIXTURE);
    const result = await textExtractor.extractText(driveFile({ mimeType: DOCX }));

    expect(result.ok).toBe(true);
    const text = result.ok ? result.text : "";
    expect(text).toContain("# Quarterly report");
    expect(text).toContain("## Outlook");
    expect(text).toContain("Revenue grew & costs fell.");
    expect(text).toMatch(/Region\s+Sales/);
  });

  it("produces chunks whose section is the real Word heading", async () => {
    const { textExtractor } = extractorFor(DOCX_FIXTURE);
    const result = await textExtractor.extractText(driveFile({ mimeType: DOCX }));
    const chunks = chunkText(result.ok ? result.text : "", wordTokenizer, { maxTokens: 500, overlapTokens: 0 });

    expect(chunks.map((c) => c.section)).toEqual(expect.arrayContaining(["Quarterly report", "Outlook"]));
  });

  it("fails closed as corrupt-file on a truncated docx, without throwing", async () => {
    const { textExtractor } = extractorFor(DOCX_FIXTURE.subarray(0, 40));
    expect(await textExtractor.extractText(driveFile({ mimeType: DOCX }))).toEqual({ ok: false, reason: "corrupt-file" });
  });

  it("fails closed as corrupt-file when a zip has no Word document in it", async () => {
    const { textExtractor } = extractorFor(zipOf({ "hello.txt": "hi" }));
    expect(await textExtractor.extractText(driveFile({ mimeType: DOCX }))).toEqual({ ok: false, reason: "corrupt-file" });
  });

  it("fails closed as password-protected on an encrypted (OLE-wrapped) docx", async () => {
    const { textExtractor } = extractorFor(OLE);
    expect(await textExtractor.extractText(driveFile({ mimeType: DOCX }))).toEqual({
      ok: false,
      reason: "password-protected",
    });
  });

  it("fails closed as corrupt-file when the converter throws", async () => {
    const { textExtractor } = extractorFor(DOCX_FIXTURE, {
      docxConverter: { toHtml: vi.fn(async () => Promise.reject(new Error("bad xml"))) },
    });
    expect(await textExtractor.extractText(driveFile({ mimeType: DOCX }))).toEqual({ ok: false, reason: "corrupt-file" });
  });
});

describe("doc (M22)", () => {
  it("extracts legacy Word text through the injected reader", async () => {
    const { textExtractor } = extractorFor(OLE, { docTextReader: { toText: vi.fn(async () => "  Legacy body\n") } });
    expect(await textExtractor.extractText(driveFile({ mimeType: "application/msword" }))).toEqual({
      ok: true,
      text: "Legacy body",
    });
  });

  it("fails closed as corrupt-file on bytes that aren't an OLE compound file", async () => {
    const reader = { toText: vi.fn() };
    const { textExtractor } = extractorFor(Buffer.from("not a doc"), { docTextReader: reader });
    expect(await textExtractor.extractText(driveFile({ mimeType: "application/msword" }))).toEqual({
      ok: false,
      reason: "corrupt-file",
    });
    expect(reader.toText).not.toHaveBeenCalled();
  });

  it("fails closed as corrupt-file when the real word-extractor can't read the file", async () => {
    const { textExtractor } = extractorFor(Buffer.concat([OLE, Buffer.alloc(600)]));
    expect(await textExtractor.extractText(driveFile({ mimeType: "application/msword" }))).toEqual({
      ok: false,
      reason: "corrupt-file",
    });
  });
});

describe("plain-text family (M23)", () => {
  it("decodes UTF-8 identically with and without a BOM", async () => {
    const plain = await extractorFor(Buffer.from("héllo")).textExtractor.extractText(driveFile());
    const withBom = await extractorFor(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("héllo")])).textExtractor.extractText(
      driveFile(),
    );
    expect(plain).toEqual({ ok: true, text: "héllo" });
    expect(withBom).toEqual(plain);
  });

  it("fails closed as unsupported-encoding on invalid UTF-8", async () => {
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9]); // "café" in Latin-1
    expect(await extractorFor(latin1).textExtractor.extractText(driveFile({ mimeType: "text/csv" }))).toEqual({
      ok: false,
      reason: "unsupported-encoding",
    });
  });

  it("returns empty text (zero chunks, no error) for an empty .txt", async () => {
    const result = await extractorFor(Buffer.alloc(0)).textExtractor.extractText(driveFile());
    expect(result).toEqual({ ok: true, text: "" });
    expect(chunkText("", wordTokenizer, { maxTokens: 50, overlapTokens: 0 })).toEqual([]);
  });

  it.each(["text/markdown", "text/x-markdown", "text/csv", "text/tab-separated-values"])("passes %s through as text", async (mimeType) => {
    expect(await extractorFor(Buffer.from("a\tb\n1\t2")).textExtractor.extractText(driveFile({ mimeType }))).toEqual({
      ok: true,
      text: "a\tb\n1\t2",
    });
  });

  it("pretty-prints JSON, and indexes unparseable JSON as-is", async () => {
    const pretty = await extractorFor(Buffer.from('{"a":1,"b":[2,3]}')).textExtractor.extractText(
      driveFile({ mimeType: "application/json" }),
    );
    expect(pretty).toEqual({ ok: true, text: '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}' });

    const broken = await extractorFor(Buffer.from("{nope")).textExtractor.extractText(driveFile({ mimeType: "application/json" }));
    expect(broken).toEqual({ ok: true, text: "{nope" });
  });

  it("drops <script>/<style> from HTML and keeps headings as Markdown", async () => {
    const html = `<html><head><style>body{color:red}</style><script>alert("x")</script></head>
      <body><h1>Title</h1><p>Body <a href="https://evil.example">link</a>.</p><h2>Sub</h2><img src="https://tracker.example/p.png"></body></html>`;
    const result = await extractorFor(Buffer.from(html)).textExtractor.extractText(driveFile({ mimeType: "text/html" }));
    expect(result.ok).toBe(true);
    const text = result.ok ? result.text : "";
    expect(text).toContain("# Title");
    expect(text).toContain("## Sub");
    expect(text).toContain("Body link.");
    expect(text).not.toMatch(/alert|color:red|evil\.example|tracker/);
  });
});

describe("spreadsheets (M24)", () => {
  it("renders one ## section per sheet, in workbook order, omitting empty and hidden sheets", async () => {
    const xlsx = xlsxOf([
      { name: "Summary", rows: [["Region", "Total"], ["North", 10]] },
      { name: "Empty", rows: [] },
      { name: "Lookup", state: "hidden", rows: [["secret"]] },
      { name: "Detail", rows: [["a, b", 'say "hi"']] },
    ]);
    const result = await extractorFor(xlsx).textExtractor.extractText(driveFile({ mimeType: XLSX }));

    expect(result).toEqual({
      ok: true,
      text: '## Summary\n\nRegion,Total\nNorth,10\n\n## Detail\n\n"a, b","say ""hi"""',
    });
  });

  it("uses each formula cell's cached value, never the formula, and resolves shared strings", async () => {
    const xlsx = xlsxOf([{ name: "Calc", rows: [] }], {
      "xl/sharedStrings.xml": `<sst><si><t>Label</t></si><si><r><t>Rich </t></r><r><t>text</t></r><rPh><t>ignored</t></rPh></si></sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><f>SUM(WEBSERVICE("http://x"))</f><v>42</v></c></row>
        <row r="2"><c r="B2" t="s"><v>1</v></c><c r="C2" t="b"><v>1</v></c></row>
      </sheetData></worksheet>`,
    });
    const result = await extractorFor(xlsx).textExtractor.extractText(driveFile({ mimeType: XLSX }));

    expect(result).toEqual({ ok: true, text: "## Calc\n\nLabel,,42\n,Rich text,TRUE" });
  });

  it("reads every table of an .ods, honouring repeated cells and hidden tables", async () => {
    const content = `<office:document-content><office:automatic-styles>
      <style:style style:name="ta1" style:family="table"><style:table-properties table:display="true"/></style:style>
      <style:style style:name="ta2" style:family="table"><style:table-properties table:display="false"/></style:style>
      </office:automatic-styles><office:body><office:spreadsheet>
      <table:table table:name="People" table:style-name="ta1">
        <table:table-row><table:table-cell office:value-type="string"><text:p>Name</text:p></table:table-cell><table:table-cell table:number-columns-repeated="2"><text:p>x</text:p></table:table-cell><table:table-cell table:number-columns-repeated="16000"/></table:table-row>
        <table:table-row table:number-rows-repeated="1048000"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>
        <table:table-row><table:table-cell office:value-type="float" office:value="3"><text:p>3.0</text:p></table:table-cell></table:table-row>
      </table:table>
      <table:table table:name="Hidden" table:style-name="ta2"><table:table-row><table:table-cell><text:p>secret</text:p></table:table-cell></table:table-row></table:table>
      </office:spreadsheet></office:body></office:document-content>`;
    const ods = zipOf({ mimetype: ODS, "content.xml": content, "META-INF/manifest.xml": "<manifest:manifest/>" });
    const result = await extractorFor(ods).textExtractor.extractText(driveFile({ mimeType: ODS }));

    expect(result).toEqual({ ok: true, text: "## People\n\nName,x,x\n3.0" });
  });

  it("fails closed as password-protected on an encrypted .ods", async () => {
    const ods = zipOf({
      "content.xml": "garbage",
      "META-INF/manifest.xml": `<manifest:manifest><manifest:file-entry manifest:full-path="content.xml"><manifest:encryption-data/></manifest:file-entry></manifest:manifest>`,
    });
    expect(await extractorFor(ods).textExtractor.extractText(driveFile({ mimeType: ODS }))).toEqual({
      ok: false,
      reason: "password-protected",
    });
  });

  it("fails closed as corrupt-file on a zip with no workbook", async () => {
    expect(await extractorFor(zipOf({ "x.xml": "<x/>" })).textExtractor.extractText(driveFile({ mimeType: XLSX }))).toEqual({
      ok: false,
      reason: "corrupt-file",
    });
  });
});

describe("presentations & OpenDocument text (M25)", () => {
  const sp = (type: string | null, paragraphs: string[]) =>
    `<p:sp><p:nvSpPr><p:nvPr>${type ? `<p:ph type="${type}"/>` : ""}</p:nvPr></p:nvSpPr><p:txBody>${paragraphs
      .map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`)
      .join("")}</p:txBody></p:sp>`;

  it("extracts pptx slide text in presentation order, with titles and speaker notes", async () => {
    const pptx = zipOf({
      "ppt/presentation.xml": `<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
      "ppt/_rels/presentation.xml.rels": `<Relationships><Relationship Id="rId2" Type="slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="slide" Target="slides/slide2.xml"/></Relationships>`,
      // slide2.xml is shown first, because of sldIdLst order.
      "ppt/slides/slide2.xml": `<p:sld><p:cSld><p:spTree>${sp("ctrTitle", ["Kick-off"])}${sp(null, ["Agenda", "Goals"])}</p:spTree></p:cSld></p:sld>`,
      "ppt/slides/slide1.xml": `<p:sld><p:cSld><p:spTree>${sp("title", ["Budget"])}<p:sp><p:txBody><a:p><a:r><a:t>Line one</a:t></a:r><a:br/><a:r><a:t>line two</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
      "ppt/slides/_rels/slide1.xml.rels": `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`,
      "ppt/notesSlides/notesSlide1.xml": `<p:notes><p:cSld><p:spTree>${sp("sldImg", [])}${sp("body", ["Mention the Q3 overrun."])}${sp("sldNum", ["2"])}</p:spTree></p:cSld></p:notes>`,
    });
    const result = await extractorFor(pptx).textExtractor.extractText(driveFile({ mimeType: PPTX }));

    expect(result).toEqual({
      ok: true,
      text:
        "## Slide 1: Kick-off\n\nAgenda\n\nGoals\n\n" +
        "## Slide 2: Budget\n\nLine one\nline two\n\nSpeaker notes:\nMention the Q3 overrun.",
    });
  });

  it("extracts odp pages with title frames and notes", async () => {
    const content = `<office:document-content><office:body><office:presentation>
      <draw:page draw:name="p1"><draw:frame presentation:class="title"><draw:text-box><text:p>Welcome</text:p></draw:text-box></draw:frame>
        <draw:frame presentation:class="outline"><draw:text-box><text:list><text:list-item><text:p>Point<text:s text:c="2"/>one</text:p></text:list-item></text:list></draw:text-box></draw:frame>
        <presentation:notes><draw:frame><draw:text-box><text:p>Say hello</text:p></draw:text-box></draw:frame></presentation:notes></draw:page>
      <draw:page draw:name="p2"/>
      </office:presentation></office:body></office:document-content>`;
    const odp = zipOf({ "content.xml": content, "META-INF/manifest.xml": "<manifest:manifest/>" });
    const result = await extractorFor(odp).textExtractor.extractText(driveFile({ mimeType: ODP }));

    expect(result).toEqual({ ok: true, text: "## Slide 1: Welcome\n\nPoint  one\n\nSpeaker notes:\nSay hello" });
  });

  it("extracts odt body text with headings at their outline level, dropping footnotes and tracked deletions", async () => {
    const content = `<office:document-content><office:body><office:text>
      <text:tracked-changes><text:changed-region><text:deletion><text:p>deleted words</text:p></text:deletion></text:changed-region></text:tracked-changes>
      <text:h text:outline-level="1">Intro</text:h>
      <text:p>First &amp; foremost<text:note><text:note-body><text:p>a footnote</text:p></text:note-body></text:note>.</text:p>
      <text:h text:outline-level="2">Details</text:h>
      <text:p>Tab<text:tab/>here</text:p><text:p/>
      </office:text></office:body></office:document-content>`;
    const odt = zipOf({ "content.xml": content, "META-INF/manifest.xml": "<manifest:manifest/>" });
    const result = await extractorFor(odt).textExtractor.extractText(driveFile({ mimeType: ODT }));

    expect(result).toEqual({ ok: true, text: "# Intro\n\nFirst & foremost.\n\n## Details\n\nTab\there" });
  });
});
