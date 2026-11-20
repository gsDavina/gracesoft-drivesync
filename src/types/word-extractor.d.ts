// word-extractor ships no type declarations; this covers the part we use.
declare module "word-extractor" {
  interface WordDocument {
    getBody(options?: { filterUnicode?: boolean }): string;
  }

  export default class WordExtractor {
    extract(source: Buffer | string): Promise<WordDocument>;
  }
}
