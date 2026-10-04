import { db, response, failure, AppError } from '@/lib/server';
import { getUser } from '@/lib/auth';
import { agentConsole } from '@/lib/agent-console';
import type { Coin } from '@/lib/model';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let row = await db().prepare('SELECT config FROM coins WHERE id=? AND token_address IS NOT NULL').bind(id).first<{ config: string }>();
    if (!row) { const user = await getUser(); if (user) row = await db().prepare('SELECT config FROM coins WHERE id=? AND owner=?').bind(id, user.userId).first<{ config: string }>(); }
    if (!row) throw new AppError(404, 'Coin not found.');
    return response(await agentConsole(JSON.parse(row.config) as Coin));
  } catch (error) { return failure(error); }
}
