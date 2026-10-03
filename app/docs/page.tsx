import type { Metadata } from "next";
import ShenApp from "@/components/shen-app";

export const metadata:Metadata={title:"SHEN Docs — Launch, agents & community",description:"Learn how SHEN launches coins with autonomous agents, how fees fund their work, and how creators and communities take part."};
export default function Docs(){return <ShenApp page="docs"/>}
