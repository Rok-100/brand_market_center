import { createCompanyAi } from './company-ai.mjs';

// Each request uses its verified caller's OA session; no shared provider key.
export async function createCommunicationAi({ fetchImpl = fetch } = {}) {
  const client = createCompanyAi({ fetchImpl });
  return {
    configured: true,
    model: client.model,
    generate(instruction, payload, maxTokens = 8192, { token } = {}) {
      return client.generate(instruction, payload, { token, maxTokens, temperature: 0.2 });
    }
  };
}
