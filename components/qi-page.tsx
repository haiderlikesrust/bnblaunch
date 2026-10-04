import Link from "next/link";
import type { ReactNode } from "react";
import QiGlyph from "./qi-glyph";

// Full-width page header shared by every platform page: kicker, two-line
// headline (second line outlined), lead copy and an optional side panel.
export function PageHero({ kicker, title, outline, lead, aside, children, crumbs }: { kicker: ReactNode; title: ReactNode; outline?: ReactNode; lead?: ReactNode; aside?: ReactNode; children?: ReactNode; crumbs?: [string, string?][] }) {
  return <section className="qi-hero qi-page-hero"><div className={"qi-wrap qi-page-hero-grid" + (aside ? "" : " single")}>
    <div className="qi-page-hero-copy">
      {crumbs && <nav className="qi-crumbs" aria-label="Breadcrumb">{crumbs.map(([label, href], i) => <span key={label + i}>{href ? <Link href={href}>{label}</Link> : <b>{label}</b>}</span>)}</nav>}
      <span className="qi-kicker">{kicker}</span>
      <h1>{title}{outline && <span className="qi-outline">{outline}</span>}</h1>
      {lead && <p className="qi-lead">{lead}</p>}
      {children}
    </div>
    {aside && <div className="qi-page-hero-aside">{aside}</div>}
  </div></section>;
}

// A titled, numbered list for hero side panels (principles, checklists, steps).
export function HeroList({ label, items, active, foot }: { label: string; items: ReactNode[]; active?: number; foot?: ReactNode }) {
  return <div className="qi-hero-list"><span className="qi-kicker">{label}</span><ol>{items.map((item, i) => <li key={i} className={active === i ? "on" : active !== undefined && i < active ? "done" : ""}><span>{String(i + 1).padStart(2, "0")}</span><div>{item}</div></li>)}</ol>{foot && <div className="qi-hero-list-foot">{foot}</div>}</div>;
}

// Centered single-purpose screen: sign in, errors, not found.
export function QiNotice({ kicker, title, outline, children }: { kicker: string; title: ReactNode; outline?: ReactNode; children: ReactNode }) {
  return <div className="qi-notice-page">
    <header className="qi-notice-bar"><Link className="qi-logo" href="/" aria-label="QI home"><img src="/qi-symbol.svg" alt="" width={26} height={26} /><span translate="no">QI</span><b translate="no">启</b></Link></header>
    <main className="qi-notice-card"><QiGlyph className="mini" /><span className="qi-kicker">{kicker}</span><h1>{title}{outline && <span className="qi-outline">{outline}</span>}</h1>{children}</main>
  </div>;
}
