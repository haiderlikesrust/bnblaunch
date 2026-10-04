import { db } from './server';
import { researchQuery, researchSources, type ResearchPreview, type ResearchIdentity } from './research-preview';

export async function recordResearch(coin: ResearchIdentity & {id:string}, runId: string, search: () => Promise<unknown>) {
  await db().prepare("INSERT INTO research_runs(id,coin_id,query,status,sources,started_at) VALUES(?,?,?,'searching','[]',?)")
    .bind(runId, coin.id, researchQuery(coin), Date.now()).run();
  try {
    const sources = researchSources(await search());
    await db().prepare("UPDATE research_runs SET status='complete',sources=?,finished_at=? WHERE id=?")
      .bind(JSON.stringify(sources), Date.now(), runId).run();
    return sources;
  } catch (error) {
    // Do not persist provider errors, credentials, or private planner context.
    await db().prepare("UPDATE research_runs SET status='unavailable',finished_at=? WHERE id=? AND status='searching'")
      .bind(Date.now(), runId).run();
    throw error;
  }
}

export async function researchHistory(coinId: string): Promise<ResearchPreview[]> {
  const rows = await db().prepare('SELECT id,query,status,sources,started_at,finished_at FROM research_runs WHERE coin_id=? ORDER BY started_at DESC,id DESC LIMIT 20')
    .bind(coinId).all<{ id: string; query: string; status: ResearchPreview['status']; sources: string; started_at: number; finished_at: number | null }>();
  return rows.results.map(row => ({ id: row.id, query: row.query, status: row.status === 'searching' && Date.now() - row.started_at > 120000 ? 'interrupted' : row.status,
    startedAt: row.started_at, finishedAt: row.finished_at, sources: researchSources(JSON.parse(row.sources)) }));
}
