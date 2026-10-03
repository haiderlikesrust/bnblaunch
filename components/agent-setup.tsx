"use client";
import { Check, Cpu, ShieldCheck } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AGENT_MODELS, DEFAULT_AGENT_MODEL, type AgentModelId } from "@/lib/agent-models";
import ModelLogo from "./model-logo";
import type { T } from "@/lib/ui";

export default function AgentSetup({purpose,modelId,onPurpose,onModel,t}:{purpose:string;modelId:string;onPurpose:(value:string)=>void;onModel:(value:AgentModelId)=>void;t:T}){
 return <div className="agent-definition">
  <div className="agent-field-heading"><div><span className="overline accent">01 / MISSION</span><h3>{t("它为何而存在？","What is this agent here to do?")}</h3></div><span className="developer-tag">{t("开发者设定","Developer-defined")}</span></div>
  <label className="form-field" htmlFor="agent-purpose">{t("智能体使命 / 自定义指令","Agent purpose / custom instructions")}
   <textarea id="agent-purpose" required minLength={20} maxLength={2000} rows={5} value={purpose} onChange={e=>onPurpose(e.target.value)}/>
   <span className="field-hint"><small>{t("定义使命、关注领域与语气。始终遵守平台规则。此内容会公开展示，请勿填写密钥。","Set its mission, focus and voice within platform rules. This is public—keep secrets out.")}</small><small>{purpose.length} / 2000</small></span>
  </label>
  <div className="agent-field-heading"><div><span className="overline accent">02 / INTELLIGENCE</span><h3>{t("选择它的思维引擎。","Choose the mind behind it.")}</h3></div><Cpu size={21}/></div>
  <RadioGroup className="model-options" aria-label={t("智能体模型","Agent model")} value={modelId||DEFAULT_AGENT_MODEL} onValueChange={v=>onModel(v as AgentModelId)}>
   {AGENT_MODELS.map(m=><label key={m.id} className={"model-option "+(modelId===m.id?"selected":"")} htmlFor={"model-"+m.family}>
    <RadioGroupItem id={"model-"+m.family} value={m.id} className="model-radio"/><span className="model-glyph"><ModelLogo modelId={m.id} size={36}/></span><span className="model-option-copy"><strong>{m.name}</strong><small>{m.maker}</small><span>{t(m.descriptionZh,m.description)}</span></span>{modelId===m.id&&<Check className="model-check" size={16}/>}</label>)}
  </RadioGroup>
  <div className="agent-boundary"><ShieldCheck size={19}/><p>{t("使命与模型由开发者设定。社区可以提问，但聊天不能下达任务或改变智能体的行为。","The developer sets the mission and model. The community can ask questions; chat cannot assign tasks or change the agent’s behavior.")}</p></div>
 </div>
}
