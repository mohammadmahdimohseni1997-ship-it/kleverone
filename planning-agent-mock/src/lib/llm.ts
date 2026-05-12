import OpenAI from "openai";

const apiKey = process.env.MOONSHOT_API_KEY;
const baseURL = process.env.MOONSHOT_BASE_URL || "https://api.moonshot.ai/v1";
export const MOONSHOT_MODEL =
  process.env.MOONSHOT_MODEL || "kimi-k2-0905-preview";

export function getKimiClient(): OpenAI {
  if (!apiKey) {
    throw new Error(
      "MOONSHOT_API_KEY is not set. Add it to .env.local and restart the dev server."
    );
  }
  return new OpenAI({
    apiKey,
    baseURL,
    maxRetries: 2,
    timeout: 90_000,
  });
}

export function isLlmConfigured(): boolean {
  return Boolean(apiKey);
}
