import { generateText } from "ai";

import { createQvacModel } from "../src/ai/qvac.ts";
import { qvacConfigFromEnv } from "../src/config.ts";

const handle = await createQvacModel(qvacConfigFromEnv());

try {
  const expected = "QVAC_REAL_OK";
  const result = await generateText({
    model: handle.model,
    prompt: `Reply with exactly: ${expected}`,
    temperature: 0,
    maxOutputTokens: 32,
  });
  process.stdout.write(`${JSON.stringify({
    modelId: handle.modelId,
    baseUrl: handle.baseUrl,
    managed: handle.managed,
    text: result.text,
    finishReason: result.finishReason,
    usage: result.usage,
  })}\n`);
  if (result.text.trim() !== expected) {
    throw new Error(`QVAC semantic smoke failed: expected ${expected}`);
  }
} finally {
  await handle.close();
}
