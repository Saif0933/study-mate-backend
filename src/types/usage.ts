export interface UsageSummaryResponse {
  totalTokens: number;
  requestCount: number;
  estimatedCost: number;
  featureBreakdown: Record<string, number>;
  quotaLimit: number;
  requestsRemaining: number;
  isExhausted: boolean;
  quotaMessage: string;
  resetTime: string;
}

export interface FeedbackResponse {
  id: string;
  userId: string;
  rating: string;
  category?: string | null;
  comment: string;
  messageId?: string | null;
  createdAt: string;
}

export interface FeedbackInput {
  rating: string;
  category?: string;
  comment: string;
  messageId?: string;
}
