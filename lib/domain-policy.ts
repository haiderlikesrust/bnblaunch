import { z } from 'zod';
export const domainProposal = z.object({
  domain: z.string().regex(/^(?!xn--)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(com|fun|xyz|ai)$/),
  kind: z.enum(['register', 'renew']),
  maxCostCents: z.number().int().min(1).max(10000),
  maxAnnualRenewalCents: z.number().int().min(1).max(10000),
  maxBnbWei: z.string().regex(/^[1-9]\d{0,77}$/),
  reason: z.string().trim().min(1).max(300),
}).strict();
export type DomainProposal = z.infer<typeof domainProposal>;
export const DOMAIN_RULES = ` A custom domain is optional. Use domain:null unless domains.enabled is true and a useful website exists or is being published. Select a suitable short ASCII name from the coin identity, never impersonate another project. Only .com/.fun/.xyz/.ai nonpremium domains are supported. To propose a purchase output domain:{domain,kind:'register'|'renew',maxCostCents,maxAnnualRenewalCents,maxBnbWei,reason}. Cents are USD cents, maxBnbWei is the TOTAL BNB ceiling including bridge and gas. Choose meaningful affordable limits from real treasury and fee income; a market valuation is not spendable money. Registration price, availability and renewal price will be checked before funding. Use transaction.kind='none' with a domain proposal. A coin has one custom domain. Renew that same domain when domains.renewalDue is true, using a fresh affordable budget; never register a replacement while an existing domain is owned. The registrar account is platform-managed; do not claim a developer owns its credentials. Purchases and renewals are confirmed separately from DNS/HTTPS. Never announce success before the recorded state is live. Hosting at the platform URL remains available if a purchase is unaffordable or the custom domain fails. Renewals are explicit orders, not unlimited account auto-renew.`;
