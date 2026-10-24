/**
 * AI StudyMate - Cost Calculator
 * Computes estimated cost in USD based on actual token counts returned by the LLM provider.
 * Never invents token counts or costs when usage metrics are not returned.
 */

export function calculateEstimatedCost(
  modelId: string,
  inputTokens?: number | null,
  outputTokens?: number | null
): number | null {
  // If neither input nor output tokens are reported, return null (never invent token metrics)
  if (inputTokens == null && outputTokens == null) {
    return null;
  }

  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;

  if (input === 0 && output === 0) {
    return 0;
  }

  // Reference pricing per 1,000,000 tokens (USD)
  let inputPerMillion = 2.50;  // Default gpt-4o: $2.50 / 1M input tokens
  let outputPerMillion = 10.00; // Default gpt-4o: $10.00 / 1M output tokens

  if (modelId.includes("mini")) {
    // gpt-4o-mini
    inputPerMillion = 0.15;
    outputPerMillion = 0.60;
  } else if (modelId.includes("embedding")) {
    // text-embedding-3-small
    inputPerMillion = 0.02;
    outputPerMillion = 0.0;
  }

  const cost = (input * inputPerMillion + output * outputPerMillion) / 1_000_000;
  return Number(cost.toFixed(6));
}
