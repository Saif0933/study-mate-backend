export interface DocumentResponse {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  pageCount: number | null;
  errorCode: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface DocumentCitationResponse {
  documentId: string;
  page: number | null;
  chunkId: string;
  excerpt: string;
}

export interface DocumentQAResult {
  answer: string;
  sources: DocumentCitationResponse[];
  hasSufficientEvidence: boolean;
  insufficientEvidence?: boolean;
  confidence?: string;
}

export interface RetrievedChunk {
  id: string;
  documentId: string;
  userId: string;
  chunkIndex: number;
  pageNumber: number | null;
  text: string;
  similarity: number;
}
