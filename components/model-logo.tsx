import { agentModel } from "@/lib/agent-models";
const logos:Record<string,string>={GLM:"glm.svg",Kimi:"kimi.png",Qwen:"qwen.png",DeepSeek:"deepseek.svg",MiniMax:"minimax.png"};
export default function ModelLogo({modelId,size=22}:{modelId?:string;size?:number}){const model=agentModel(modelId);return <img className="provider-logo" src={"/models/"+logos[model.family]} alt={model.maker+" logo"} width={size} height={size} style={{width:size,height:size,objectFit:"contain",flexShrink:0}}/>}
