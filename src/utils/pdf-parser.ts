import { logger } from "./logger";

export interface ParsedPdfPage {
  pageNumber: number;
  text: string;
}

export interface ParsedPdfSuccess {
  success: true;
  pageCount: number;
  pages: ParsedPdfPage[];
  fullText: string;
}

export interface ParsedPdfFailure {
  success: false;
  errorCode: "ENCRYPTED_PDF" | "CORRUPTED_PDF" | "SCANNED_OR_EMPTY_PDF";
  message: string;
}

export type ParsedPdfResult = ParsedPdfSuccess | ParsedPdfFailure;

export async function parsePdfDocument(buffer: Buffer): Promise<ParsedPdfResult> {
  try {
    // Dynamic import / require for pdf-parse v2 compatibility
    const pdfModule = require("pdf-parse");
    const PDFParse = pdfModule.PDFParse || pdfModule;

    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();

    const rawPages: Array<{ text?: string; num?: number }> = result.pages || [];
    const totalCount: number = result.total || rawPages.length || 1;

    const parsedPages: ParsedPdfPage[] = [];
    let combinedText = "";

    for (let i = 0; i < rawPages.length; i++) {
      const page = rawPages[i];
      const pageNum = page?.num || i + 1;
      const text = (page?.text || "").trim();
      if (text.length > 0) {
        parsedPages.push({
          pageNumber: pageNum,
          text,
        });
        combinedText += `\n${text}`;
      }
    }

    const trimmedCombined = combinedText.trim();

    // Check for empty or scanned PDF where text extraction yielded little or nothing
    if (parsedPages.length === 0 || trimmedCombined.length < 15) {
      return {
        success: false,
        errorCode: "SCANNED_OR_EMPTY_PDF",
        message: "The PDF contains no readable text. It may be scanned or image-only.",
      };
    }

    return {
      success: true,
      pageCount: totalCount,
      pages: parsedPages,
      fullText: trimmedCombined,
    };
  } catch (error: unknown) {
    const err = error as Error;
    const msg = (err?.message || "").toLowerCase();
    const name = (err?.name || "").toLowerCase();

    logger.warn({ err: err?.message, name: err?.name }, "PDF extraction encountered an error");

    if (
      msg.includes("password") ||
      msg.includes("encrypt") ||
      name.includes("password")
    ) {
      return {
        success: false,
        errorCode: "ENCRYPTED_PDF",
        message: "The PDF document is password-protected or encrypted.",
      };
    }

    return {
      success: false,
      errorCode: "CORRUPTED_PDF",
      message: "The PDF file is corrupted or could not be parsed.",
    };
  }
}
