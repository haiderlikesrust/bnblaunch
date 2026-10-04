export type ResearchSource = { title: string; url: string; description: string };
export type ResearchPreview = { id: string; query: string; status: 'searching' | 'complete' | 'unavailable' | 'interrupted'; startedAt: number; finishedAt: number | null; sources: ResearchSource[] };
export type ResearchIdentity={name:string;symbol:string;focus?:string;purpose?:string;description?:string;nextResearchQuery?:string|null};
export function researchQuery(coin:ResearchIdentity){
  // Follow a previous approved plan, otherwise start from the mission rather
  // than assuming a similarly named search result belongs to this token.
  const topic=coin.nextResearchQuery||coin.focus||coin.purpose||coin.description;
  return topic?topic.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,240)||`${coin.name} ${coin.symbol} BNB`:`${coin.name} ${coin.symbol} BNB`;
}

// Search results are untrusted. Render text only and never embed a remote page.
export function researchSources(value: unknown): ResearchSource[] {
  if (!Array.isArray(value)) return [];
  const sources: ResearchSource[] = [], seen = new Set<string>();
  for (const item of value.slice(0, 5)) {
    if (!item || typeof item !== 'object' || typeof item.url !== 'string' || item.url.length > 2048) continue;
    try {
      const url = new URL(item.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || seen.has(url.href)) continue;
      seen.add(url.href);
      sources.push({ url: url.href, title: typeof item.title === 'string' ? item.title.slice(0, 300) : url.hostname, description: typeof item.description === 'string' ? item.description.slice(0, 1200) : '' });
    } catch { /* Invalid provider links are omitted. */ }
  }
  return sources;
}
