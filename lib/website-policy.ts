import { z } from 'zod';

// The agent authors text and chooses a visual direction. It cannot publish
// scripts, arbitrary URLs, forms, or executable HTML on the platform origin.
const copy=(max:number)=>z.string().trim().min(1).max(max);
export const websiteInput=z.object({
 title:copy(80),tagline:copy(180),about:copy(1800),
 theme:z.enum(['ember','jade','porcelain']).default('ember'),
 layout:z.enum(['editorial','signal']).default('editorial'),
 sections:z.array(z.object({heading:copy(80),body:copy(900)}).strict()).max(4).default([]),
 faq:z.array(z.object({question:copy(140),answer:copy(500)}).strict()).max(4).default([]),
}).strict();
export type AgentWebsite=z.infer<typeof websiteInput>;
export type PublishedWebsite=AgentWebsite&{url:string;revision:number;publishedAt:number};
export const websitePath=(coinId:string)=>'/sites/'+encodeURIComponent(coinId);
