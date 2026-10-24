-- Create HNSW index for cosine similarity search on DocumentChunk embedding
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx" 
ON "DocumentChunk" USING hnsw (embedding vector_cosine_ops);
