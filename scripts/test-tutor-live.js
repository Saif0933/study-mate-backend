const { tutorGraph } = require('../dist/ai/graphs/tutor.graph');

async function testTutorLive() {
  console.log("Testing tutorGraph with user's Gemini key...");
  const startTime = Date.now();
  
  const result = await tutorGraph.invoke({
    userId: "test-user-1",
    userMessage: "What is Newton's second law of motion? Give a 1-sentence explanation.",
    chatHistory: [],
    explanationMode: "socratic"
  });

  console.log("=== AI TUTOR RESPONSE ===");
  console.log("Content:", result.responseContent);
  console.log("Input tokens:", result.inputTokens);
  console.log("Output tokens:", result.outputTokens);
  console.log("Latency:", result.latencyMs, "ms");
  console.log("Time elapsed:", Date.now() - startTime, "ms");
}

testTutorLive().catch(err => {
  console.error("Live test failed:", err);
});
