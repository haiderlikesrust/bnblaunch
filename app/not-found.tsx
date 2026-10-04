import Link from "next/link";
import { QiNotice } from "@/components/qi-page";
export default function NotFound(){
  return <QiNotice kicker="QI · 404" title="This door" outline="is not open."><p className="qi-lead">The page you were looking for does not exist or has moved.</p><div className="qi-notice-actions"><Link className="qi-btn" href="/">Discover agents</Link><Link className="qi-btn qi-btn-ghost" href="/launch">Launch a token</Link></div></QiNotice>;
}
