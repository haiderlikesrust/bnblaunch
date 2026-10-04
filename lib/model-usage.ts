import { db } from './server';
export type UsageContext = { coinId: string; runId: string; kind: string };
type Receipt = { id?: string; model?: string; usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; prompt_tokens_details?: { cached_tokens?: number } } };
const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
export async function recordModelUsage(context: UsageContext, price: { id: string; prompt: number; completion: number }, receipt: Receipt, ceiling: number) {
  const usage = receipt.usage, cost = typeof usage?.cost === 'number' && Number.isFinite(usage.cost) && usage.cost >= 0 ? Math.ceil(usage.cost * 1e6) : null;
  await db().prepare('INSERT INTO model_usage(id,coin_id,run_id,kind,model,generation_id,prompt_tokens,completion_tokens,reasoning_tokens,cached_tokens,cost_microusd,quoted_prompt,quoted_completion,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), context.coinId, context.runId, context.kind, price.id, typeof receipt.id === 'string' ? receipt.id.slice(0, 200) : null, count(usage?.prompt_tokens), count(usage?.completion_tokens), count(usage?.completion_tokens_details?.reasoning_tokens), count(usage?.prompt_tokens_details?.cached_tokens), cost !== null && Number.isSafeInteger(cost) ? cost : null, String(price.prompt), String(price.completion), cost !== null && Number.isSafeInteger(cost) && cost <= ceiling ? 'recorded' : 'reconciliation_required', Date.now()).run();
}
