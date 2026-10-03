import ShenApp from "@/components/shen-app";
export default async function Token({params}:{params:Promise<{id:string}>}){return <ShenApp page="token" coinId={(await params).id}/>}
