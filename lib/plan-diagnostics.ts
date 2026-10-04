import { z } from 'zod';

// Public diagnostics contain schema-owned names and fixed descriptions only.
// Never publish model output, Zod's received values, or a guard's free text.
const messages={
  interrupted:'The planning attempt was interrupted. Its unverified cost remains reserved separately; a new attempt can use the remaining credit.',
  schema:'The plan did not match the required format.',
  invalid_json:'The planner did not return valid JSON.',
  planner_output:'The planner returned an incomplete or unsupported response.',
  planner_truncated:'The planner response reached its output limit.',
  guard_output:'The plan reviewer did not return a valid decision.',
  guard_truncated:'The plan review reached its output limit.',
  guard_denied:'The independent review did not approve the plan.',
  tool_budget:'The planner requested another tool after its research allowance was used.',
  browser_source:'The requested page was not an available recorded research source.',
  research_unavailable:'The planner requested research that is unavailable.',
  policy:'The plan did not meet the execution requirements.',
  provider_unavailable:'A model or research provider did not complete the request. Verified costs were settled; any unknown charge stays reserved separately.',
} as const;
const keys=new Set('task id goal nextStep status evidence kind treasuryThesis buyback rewards reserve creative reason nextResearchQuery memory summary nextCheckMinutes closeChatMinutes transaction amountWei domain maxCostCents maxAnnualRenewalCents maxBnbWei website title tagline about theme layout sections heading body faq question answer publication destination text imagePrompt altText tool query url'.split(' '));
const policies=[
  'No-action plans must have zero amount','Transaction amount must be positive','Buyback exceeds available funds','Burn exceeds token balance','Domain budget exceeds funds or conflicts with a transaction',
  'Buyback policy disabled','Domain capability unavailable','Treasury operations are limited to one per hour','Treasury operation exceeds its pacing limit','Burn exceeds its pacing limit','Publication links are limited to SHEN, X, BscScan and Flap','Task does not belong to this coin','Closed tasks cannot be rewritten','A new task must start active','Active task limit reached','Task completion requires a receipt','Task completion receipt is not confirmed for this task','Only completed tasks carry completion evidence','X account is not ready','Image generation is not enabled','A publication is already pending','This publication text is already recorded; continue other useful work',
] as const;
const issueSchema=z.object({path:z.array(z.union([z.string().refine(v=>keys.has(v)),z.number().int().min(0).max(1000)])).max(8),rule:z.enum(['too_small','too_big','invalid_type','invalid_enum_value','invalid_string','unrecognized_keys','custom','other']),limit:z.number().finite().min(0).max(1000000).optional()}).strict();
const diagnosticSchema=z.object({code:z.enum(Object.keys(messages) as [keyof typeof messages,...(keyof typeof messages)[]]),issues:z.array(issueSchema).max(8).optional(),policy:z.enum(policies).optional(),reviewReason:z.string().max(1000).optional()}).strict();
export type PlanDiagnostic=z.infer<typeof diagnosticSchema>;
export function planValidationDiagnostic(error:unknown):PlanDiagnostic{
  if(error instanceof z.ZodError)return {code:'schema',issues:error.issues.slice(0,8).map(issue=>({
    path:issue.path.slice(0,8).filter(v=>typeof v==='number'?Number.isInteger(v)&&v>=0&&v<=1000:keys.has(v)),
    rule:issueSchema.shape.rule.safeParse(issue.code).success?issue.code as z.infer<typeof issueSchema>['rule']:'other',
    ...('maximum'in issue&&typeof issue.maximum==='number'?{limit:issue.maximum}:'minimum'in issue&&typeof issue.minimum==='number'?{limit:issue.minimum}:{}),
  }))};
  return {code:'policy',...(error instanceof Error&&policies.includes(error.message as typeof policies[number])?{policy:error.message as typeof policies[number]}:{})};
}
export function readPlanDiagnostic(output:string|null|undefined):PlanDiagnostic|null{
  try{const parsed=diagnosticSchema.safeParse(JSON.parse(output??'').rejection);return parsed.success?parsed.data:null;}catch{return null;}
}
export function publicPlanDiagnostic(value:PlanDiagnostic){
  const details=value.issues?.map(i=>{
    const field=i.path.join('.')||'plan';
    const rule=i.rule==='too_big'?`exceeds the maximum${i.limit===undefined?'':` of ${i.limit}`}`:i.rule==='too_small'?`is below the minimum${i.limit===undefined?'':` of ${i.limit}`}`:i.rule==='invalid_type'?'is missing or has the wrong type':i.rule==='unrecognized_keys'?'contains unsupported fields':i.rule==='invalid_enum_value'?'has an unsupported option':i.rule==='custom'&&field==='treasuryThesis'?'percentages must sum to 100':i.rule==='custom'&&field==='publication'?'exceeds the X text limit':'does not meet its format requirements';
    return `${field}: ${rule}`;
  });
  return {code:value.code,message:[messages[value.code],value.policy,...details??[]].filter(Boolean).join(' ')};
}
