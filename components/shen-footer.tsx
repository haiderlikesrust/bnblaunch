"use client";
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import type { T } from '@/lib/ui';
import { X_HANDLE } from './shen-header';

export function usePlatformToken() {
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/platform', { signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const data = await response.json() as { shenTokenAddress?: unknown };
      if (typeof data.shenTokenAddress === 'string' && /^0x[0-9a-fA-F]{40}$/.test(data.shenTokenAddress)) setAddress(data.shenTokenAddress);
    }).catch(() => {});
    return () => controller.abort();
  }, []);
  return address;
}

export function TokenContract({ t, address }: { t: T; address: string | null }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2500); return () => clearTimeout(timer); }, [copied]);
  async function copy() {
    if (!address) return;
    try { await navigator.clipboard.writeText(address); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  if (!address) return <span className="footer-contract-pending">{t('合约地址尚未公布', 'Contract address not published yet')}</span>;
  return <div className="footer-contract"><a href={`https://bscscan.com/token/${address}`} target="_blank" rel="noopener noreferrer" aria-label={t('在 BscScan 查看 QI 合约', 'View QI contract on BscScan')}><code>{address}</code><ExternalLink size={13}/></a><button type="button" onClick={copy} aria-label={t('复制 QI 合约地址', 'Copy QI contract address')} title={t('复制合约地址', 'Copy contract address')}>{copied ? <Check size={15}/> : <Copy size={15}/>}</button><span className="sr-only" role="status">{copied ? t('地址已复制', 'Address copied') : copyError ? t('无法复制，请选择地址手动复制。', 'Unable to copy. Select the address to copy it manually.') : ''}</span></div>;
}

export default function ShenFooter({ t }: { t: T }) {
  const address = usePlatformToken();
  return <footer className="qi-footer">
    <div className="qi-wrap qi-footer-grid">
      <div className="qi-footer-brand"><Link href="/" className="qi-logo" translate="no"><img src="/qi-symbol.svg" alt="" width={26} height={26}/><span>QI</span><b>启</b></Link><p>{t('启：开启，发行，唤醒。每个代币，都有一个自主运作的智能体。', 'Qǐ (启): to open, to launch, to awaken. Every token gets an agent that works on its own.')}</p></div>
      <nav className="qi-footer-col" aria-label={t('平台链接', 'Platform links')}><span className="qi-label">{t('平台', 'PLATFORM')}</span><Link href="/">{t('探索', 'Discover')}</Link><Link href="/launch">{t('发行代币', 'Launch a token')}</Link><Link href="/agents">{t('我的智能体', 'My agents')}</Link><Link href="/docs">{t('文档', 'Docs')}</Link></nav>
      <nav className="qi-footer-col" aria-label={t('社区链接', 'Community links')}><span className="qi-label">{t('社区', 'COMMUNITY')}</span><a href={`https://x.com/${X_HANDLE}`} target="_blank" rel="noopener noreferrer">𝕏 @{X_HANDLE} <ExternalLink size={12}/></a><a href="https://flap.sh" target="_blank" rel="noopener noreferrer">Flap <ExternalLink size={12}/></a><a href="https://bscscan.com" target="_blank" rel="noopener noreferrer">BscScan <ExternalLink size={12}/></a></nav>
      <div className="qi-footer-col qi-footer-token"><span className="qi-label">$QI · BNB CHAIN</span><TokenContract t={t} address={address}/></div>
    </div>
    <div className="qi-wrap qi-footer-bottom"><span>{t('自主行动，始于透明。', 'AUTONOMY STARTS WITH TRANSPARENCY.')}</span><span>BUILT ON FLAP · BNB CHAIN</span></div>
  </footer>;
}
