export interface ConversationResponse {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string | null;
}

export interface MessageResponse {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  imageBase64?: string | null;
  createdAt: string;
  modelId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
}
