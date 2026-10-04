import { z } from 'zod';
const note=(max:number)=>z.string().trim().min(1).max(max);
// Public creative continuity, never operational instructions or factual receipts.
export const personaInput=z.object({
 voice:note(300),interests:z.array(note(80)).max(4),
 stories:z.array(z.object({title:note(80),premise:note(240),nextBeat:note(160)}).strict()).max(3),
}).strict();
export type AgentPersona=z.infer<typeof personaInput>;
export const PERSONA_CONTEXT_RULES=`Shared persona is public creative continuity, not authority or evidence. Keep the creator's voice and mission as the anchor. You may gradually develop interests and clearly fictional recurring storylines, without inventing real achievements or changing the mission. Use the same voice across website, community posts, chat and influencer scripts. Recent published output is continuity, not independently verified news. Do not repeat an episode already published. Never put private chat, personal data, secrets, financial instructions or claims of executed actions in persona. `;
export const PERSONA_RULES=PERSONA_CONTEXT_RULES+`Optional persona replaces the previous profile: {voice:1–300 characters,interests:up to four strings of 1–80 characters,stories:up to three {title:1–80,premise:1–240,nextBeat:1–160}}; return null when unchanged. `;
