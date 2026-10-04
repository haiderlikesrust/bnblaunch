import { AGENT_MODELS } from '@/lib/agent-models';
import { chatPrice } from '@/lib/chat-completion';
import { response } from '@/lib/server';
export async function GET() {
  const models = await Promise.all(AGENT_MODELS.map(async model => {
    try { const price = await chatPrice(model.id); return { id: model.id, available: true, inputPerMillionUsd: price.prompt * 1e6, outputPerMillionUsd: price.completion * 1e6 }; }
    catch { return { id: model.id, available: false }; }
  }));
  return response({ models, checkedAt: Date.now() });
}
