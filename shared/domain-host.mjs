/** The initial registrar policy accepts ASCII apex names only. Never normalize a URL into a domain. */
export function normalizeCustomDomain(value) {
 if(typeof value!=='string'||value!==value.trim()||value.length>67)throw new Error('Use an ASCII apex domain.');
 const domain=value.toLowerCase();
 if(!/^(?!xn--)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(com|fun|xyz|ai)$/.test(domain))throw new Error('Use an ASCII apex domain with an approved extension.');
 return domain;
}

/** Reject alternate IP spellings and every non-global IPv4 range used by this service. */
export function publicIpv4(value) {
 if(typeof value!=='string'||!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value))return false;
 const p=value.split('.').map(Number);
 if(p.some((n,i)=>n>255||String(n)!==value.split('.')[i]))return false;
 const [a,b,c]=p;
 return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===0||b===168||(b===88&&c===99)))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));
}

/** Strict Host parsing: never trust a forwarded host list, URL, path, or alternate authority. */
export function requestHostname(value) {
 if(typeof value!=='string'||!value||value!==value.trim()||/[\s,@/\\?#]/.test(value))return null;
 const match=/^([a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)(?::(\d{1,5}))?$/i.exec(value);
 if(!match||match[2]&&(Number(match[2])<1||Number(match[2])>65535))return null;
 const hostname=match[1].toLowerCase();
 if(hostname.split('.').some(label=>!label||label.length>63||label.startsWith('-')||label.endsWith('-')))return null;
 return hostname;
}

/** Custom hosts serve one published site, its own public images, and bundled assets only. */
export function customHostRoute(pathname,coinId) {
 if(typeof pathname!=='string'||typeof coinId!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(coinId)||/[\\%?#\u0000-\u0020]/.test(pathname)||pathname.includes('//')||pathname.split('/').some(p=>p==='.'||p==='..'))return 'blocked';
 if(pathname==='/'||pathname===`/sites/${coinId}`)return 'site';
 if(pathname==='/.well-known/shen-site')return 'verification';
 if(/^\/(?:assets|_next\/static|fonts|models)\/[a-zA-Z0-9_./-]+$/.test(pathname)||pathname==='/favicon.ico'||pathname==='/shen-symbol.png'||pathname==='/qi-symbol.svg'||pathname==='/favicon.svg')return 'asset';
 if(pathname===`/api/coins/${coinId}/image`||new RegExp(`^/api/coins/${coinId}/publications/[-a-zA-Z0-9_:]{1,150}/image$`).test(pathname))return 'asset';
 return 'blocked';
}
