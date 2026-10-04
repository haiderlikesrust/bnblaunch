"use client";
import { useEffect, useState } from 'react';
import { ArrowUpRight, Globe2, LoaderCircle, Search } from 'lucide-react';
import type { ResearchPreview } from '@/lib/research-preview';
import ResearchBrowser from './research-browser';
import type { BrowserSession } from '@/lib/browser-research';
import type { T } from '@/lib/ui';

export default function ResearchFeed({ coinId, enabled, t }: { coinId: string; enabled: boolean; t: T }) {
  const [browserSessions,setBrowserSessions]=useState<BrowserSession[]>([]);
  const [searches, setSearches] = useState<ResearchPreview[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/coins/${coinId}/research`, { signal: controller.signal });
        if (!response.ok) throw Error('Research unavailable');
        const data = await response.json() as { searches: ResearchPreview[];browserSessions?:BrowserSession[] };
        if (active) { setSearches(data.searches);setBrowserSessions(data.browserSessions??[]); setError(false); }
      } catch { if (active) setError(true); }
      finally { if (active) setLoading(false); }
    }
    setSearches([]);setBrowserSessions([]); setLoading(true); setError(false);
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, [coinId]);
  const labels = { searching: t('正在搜索', 'Searching'), complete: t('搜索完成', 'Search complete'), unavailable: t('搜索未完成', 'Search unavailable'), interrupted: t('搜索状态未确认', 'Search interrupted') };
  return <section className="panel research-panel" aria-label={t('公开研究记录', 'Public research feed')}>
    <div className="research-heading"><div className="research-emblem"><Globe2 size={24}/></div><div><span className="overline accent">{t('智能体观察室', 'AGENT OBSERVATORY')}</span><h2>{t('跟随它的好奇心。', 'Follow its curiosity.')}</h2></div><span className="research-public">{t('公开记录', 'PUBLIC FEED')}</span></div>
    <p className="research-intro">{t('查看智能体实际搜索的内容与发现的来源。以下为搜索结果摘要，不代表已阅读全文或认可来源。', 'See what the agent searches for and the sources it discovers. These are search snippets, not evidence that it read or endorsed the full pages.')}</p>
    <ResearchBrowser sessions={browserSessions} t={t}/>
    {error && <p className="form-error" role="status">{t('暂时无法刷新研究记录。稍后自动重试。', 'Could not refresh research. Retrying shortly.')}</p>}
    {loading ? <div className="empty-state" role="status"><LoaderCircle className="spin"/><p>{t('正在读取研究记录…', 'Loading research…')}</p></div> : searches.length ? <div className="research-history">{searches.map((search, index) => <article className="research-session" key={search.id}>
      <div className="research-session-meta"><span className="overline">{index === 0 ? t('最近搜索', 'LATEST SEARCH') : t('搜索记录', 'SEARCH LOG')}</span><time dateTime={new Date(search.startedAt).toISOString()}>{new Date(search.startedAt).toLocaleString()}</time><span className={'research-state ' + search.status}>{search.status === 'searching' && <LoaderCircle size={12} className="spin"/>}{labels[search.status]}</span></div>
      <div className="research-query"><Search size={18}/><h3>{search.query}</h3></div>
      {search.sources.length > 0 ? <ol className="research-sources">{search.sources.map((source, i) => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer nofollow"><span className="research-source-number">{String(i + 1).padStart(2, '0')}</span><div><span className="research-domain">{new URL(source.url).hostname}</span><h4>{source.title}</h4>{source.description && <p>{source.description}</p>}</div><ArrowUpRight size={17}/></a></li>)}</ol> : <p className="research-no-results">{search.status === 'searching' ? t('正在等待搜索结果…', 'Waiting for search results…') : search.status === 'complete' ? t('本次搜索没有可展示的来源。', 'No sources were returned for this search.') : t('本次搜索没有已确认的结果。', 'No confirmed results from this search.')}</p>}
    </article>)}</div> : !error && <div className="empty-state"><Search size={28}/><h3>{t('尚无搜索记录', 'No research yet')}</h3><p>{enabled ? t('智能体开始研究后，真实搜索记录会出现在这里。', 'Searches will appear here when the agent begins researching.') : t('此智能体未启用网络研究。', 'Web research is not enabled for this agent.')}</p></div>}
    <div className="research-footnote"><span>{t('最近 20 次搜索', 'Latest 20 searches')}</span><span>{t('每 15 秒刷新', 'Refreshes every 15 seconds')}</span></div>
  </section>;
}
