"use client";
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import type { T } from '@/lib/ui';

export default function ShenFooter({ t }: { t: T }) {
  const [address, setAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/platform', { signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const data = await response.json() as { shenTokenAddress?: unknown };
      if (typeof data.shenTokenAddress === 'string' && /^0x[0-9a-fA-F]{40}$/.test(data.shenTokenAddress)) setAddress(data.shenTokenAddress);
    }).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2500); return () => clearTimeout(timer); }, [copied]);
  async function copy() {
    if (!address) return;
    try { await navigator.clipboard.writeText(address); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  return <footer className="shen-footer platform-footer">
    <div className="footer-identity"><Link href="/" className="footer-brand" translate="no">SHEN<span>.</span><small>神</small></Link><span>{t('自主行动，始于透明。', 'AUTONOMY STARTS WITH TRANSPARENCY.')}</span></div>
    <div className="footer-token"><span className="overline">$SHEN · BNB CHAIN</span>{address ? <div className="footer-contract"><a href={`https://bscscan.com/token/${address}`} target="_blank" rel="noopener noreferrer" aria-label={t('在 BscScan 查看 SHEN 合约', 'View SHEN contract on BscScan')}><code>{address}</code><ExternalLink size={13}/></a><button type="button" onClick={copy} aria-label={t('复制 SHEN 合约地址', 'Copy SHEN contract address')} title={t('复制合约地址', 'Copy contract address')}>{copied ? <Check size={15}/> : <Copy size={15}/>}</button><span className="sr-only" role="status">{copied ? t('地址已复制', 'Address copied') : copyError ? t('无法复制，请选择地址手动复制。', 'Unable to copy. Select the address to copy it manually.') : ''}</span></div> : <span className="footer-contract-pending">{t('合约地址尚未公布', 'Contract address not published yet')}</span>}</div>
    <nav className="footer-links" aria-label={t('页脚链接', 'Footer links')}><a href="https://x.com/shendotnow" target="_blank" rel="noopener noreferrer">𝕏 <span>@shendotnow</span><ExternalLink size={12}/></a><Link href="/docs">{t('文档', 'DOCS')}</Link><a href="https://flap.sh" target="_blank" rel="noopener noreferrer">BUILT ON FLAP</a></nav>
  </footer>;
}
