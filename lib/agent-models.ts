// Curated Chinese model families, verified against OpenRouter's model catalog.
// IDs are allowlisted on the server. A visitor cannot supply a different model.
export const AGENT_MODELS = [
  {id:"z-ai/glm-5.3",name:"GLM 5.3",maker:"Z.ai",family:"GLM",glyph:"智",description:"General reasoning and planning",descriptionZh:"综合推理与规划"},
  {id:"moonshotai/kimi-k3",name:"Kimi K3",maker:"Moonshot AI",family:"Kimi",glyph:"月",description:"Research and long-form context",descriptionZh:"研究与长文本理解"},
  {id:"qwen/qwen3.8-max-0902",name:"Qwen 3.8 Max",maker:"Alibaba",family:"Qwen",glyph:"千",description:"Multilingual community work",descriptionZh:"多语言社区工作"},
  {id:"deepseek/deepseek-v4-pro-0813",name:"DeepSeek V4 Pro",maker:"DeepSeek",family:"DeepSeek",glyph:"深",description:"Analysis and technical reasoning",descriptionZh:"分析与技术推理"},
  {id:"minimax/minimax-m3",name:"MiniMax M3",maker:"MiniMax",family:"MiniMax",glyph:"海",description:"Writing and agent workflows",descriptionZh:"写作与智能体工作流"},
] as const;
export type AgentModelId = typeof AGENT_MODELS[number]["id"];
export const DEFAULT_AGENT_MODEL:AgentModelId = "z-ai/glm-5.3";
export const GUARDRAIL_MODEL:AgentModelId = "qwen/qwen3.8-max-0902";
export const DEFAULT_AGENT_PURPOSE = "Research the token's ecosystem, explain verified developments, and build an informed community. Plan sustainable use of available funds and report outcomes transparently.";
export function agentModel(id?:string){return AGENT_MODELS.find(m=>m.id===id)??AGENT_MODELS[0]}
export function isAgentModel(id:unknown):id is AgentModelId{return AGENT_MODELS.some(m=>m.id===id)}
