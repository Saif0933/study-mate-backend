import { ParsedPdfPage } from "./pdf-parser";

export interface DocumentChunkDraft {
  chunkIndex: number;
  pageNumber: number | null;
  text: string;
}

export interface SplitOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: string[];
}

export class RecursiveTextSplitter {
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;
  private readonly separators: string[];

  constructor(options: SplitOptions = {}) {
    this.chunkSize = options.chunkSize ?? 800;
    this.chunkOverlap = options.chunkOverlap ?? 150;
    this.separators = options.separators ?? ["\n\n", "\n", ". ", "? ", "! ", " ", ""];
  }

  /**
   * Splits a single piece of text recursively using the prioritized separators.
   */
  private splitText(text: string, separators: string[]): string[] {
    const finalChunks: string[] = [];
    const separator = separators[0] ?? "";
    const nextSeparators = separators.slice(1);

    const splits = separator.length > 0 ? text.split(separator) : Array.from(text);
    const currentDoc: string[] = [];
    let currentLength = 0;

    for (const split of splits) {
      const piece = split.trim();
      if (!piece) continue;

      const pieceLength = piece.length + (separator.length > 0 ? separator.length : 0);

      if (currentLength + pieceLength > this.chunkSize && currentDoc.length > 0) {
        const chunkText = currentDoc.join(separator).trim();
        if (chunkText.length > 0) {
          finalChunks.push(chunkText);
        }

        // Apply overlap: keep trailing segments that fit within overlap limit
        while (currentLength > this.chunkOverlap && currentDoc.length > 1) {
          const removed = currentDoc.shift()!;
          currentLength -= removed.length + (separator.length > 0 ? separator.length : 0);
        }
      }

      // If a single piece is itself larger than chunkSize and we have deeper separators
      if (piece.length > this.chunkSize && nextSeparators.length > 0) {
        const subChunks = this.splitText(piece, nextSeparators);
        finalChunks.push(...subChunks);
      } else {
        currentDoc.push(piece);
        currentLength += pieceLength;
      }
    }

    if (currentDoc.length > 0) {
      const chunkText = currentDoc.join(separator).trim();
      if (chunkText.length > 0) {
        finalChunks.push(chunkText);
      }
    }

    return finalChunks;
  }

  /**
   * Splits parsed PDF pages into overlapping chunks while preserving page number metadata.
   */
  splitPages(pages: ParsedPdfPage[]): DocumentChunkDraft[] {
    const chunks: DocumentChunkDraft[] = [];
    let chunkIndex = 0;

    for (const page of pages) {
      const rawText = page.text.trim();
      if (!rawText) continue;

      const pageChunks = this.splitText(rawText, this.separators);

      for (const piece of pageChunks) {
        const cleanText = piece.trim();
        if (cleanText.length >= 10) {
          chunks.push({
            chunkIndex,
            pageNumber: page.pageNumber,
            text: cleanText,
          });
          chunkIndex++;
        }
      }
    }

    return chunks;
  }
}

export const defaultTextSplitter = new RecursiveTextSplitter();
