# M25 — Presentations & OpenDocument

Status: **Done** (`.ppt` deferred, as planned)

## What was built

- `src/extraction/extractors/presentation.ts`:
  - **`.pptx`** — slides in **presentation order** (`p:sldIdLst` in `ppt/presentation.xml`, resolved through its rels), not file-name order. Each `<a:p>` paragraph's `<a:t>` runs are joined, `<a:br/>` kept as a line break. The `title`/`ctrTitle` placeholder becomes the slide title and is removed from the body. Speaker notes come from the slide's `notesSlide` relationship, body placeholder only (not the slide image or slide-number placeholders).
  - **`.odp`** — each `draw:page`; the `presentation:class="title"` frame is the title; `presentation:notes` are the speaker notes.
  - `renderSlides` — `## Slide N: <title>` (or `## Slide N`), the slide's paragraphs, then `Speaker notes:` and the notes. Slides with no text at all are left out (numbering still follows the deck).
  - **`.odt`** — body of `office:text`; `<text:h>` rendered as `#` × outline level (capped at 6), `<text:p>` as paragraphs. Footnotes, comments and tracked-change deletions are dropped.
- Encrypted ODF → `password-protected` (shared check with `.ods`).

## Decisions

- **In-house reader instead of `officeparser`.** Same reasons as M24: `officeparser@8.x` needs Node 22+ and pulls in `pdfjs-dist` and `tesseract.js`. Slide and ODF text is a small, well-defined part of each format, and reading it directly keeps every file behind the M21 zip guard.
- **Speaker notes are included.** They often hold the narrative the slides only outline, which is exactly what retrieval should find. They're labelled `Speaker notes:` so a reader of a chunk can tell them apart from slide text.
- **Slide headings include the title** (`## Slide 3: Budget`) so the chunk `section` is meaningful, while the number keeps sections unique when titles repeat.
- **Footnotes and tracked-change deletions in `.odt` are dropped.** Deleted text isn't part of the document; footnotes are a candidate refinement (append them at the end).
- **Known limitation:** the ODF readers use a non-nesting element matcher. A paragraph inside a text frame inside another paragraph (an image caption anchored in a paragraph) can split that outer paragraph's text in two. Text is still captured, only paragraph boundaries can be off.
- **`.ppt` deferred** (binary OLE format), per the checklist's deferred list.

## Verified locally

- `formats.test.ts`, presentations block: a two-slide pptx whose `sldIdLst` order differs from file names comes out in presentation order, with `ctrTitle`/`title` titles, a line break within a paragraph, and speaker notes that exclude the slide-number placeholder; an odp page with a title frame, a list item using `<text:s text:c="2"/>`, notes, and an empty second page (omitted); an odt with two heading levels, an `&amp;` entity, a footnote and a tracked deletion (both dropped), a tab, and an empty paragraph.

## Explicitly not covered by this pass

- Real PowerPoint/Impress/Writer files (grouped shapes, tables in slides, SmartArt). Testing checklist integration item.

## Next

M26 — Google Docs Markdown export.
