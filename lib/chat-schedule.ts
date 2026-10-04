export type ChatWindow={open:boolean;cadence:"hourly"|"four-hourly"|"daily"|"closed";durationMinutes:number;closesAt:number|null;nextOpensAt:number|null;reason:"growing"|"steady"|"conserving"|"funding"|"paused"|"stale"|"agent_closed"|"platform_setup";checkedAt:number};
// fundedMicrousdDaily: average daily verified treasury-to-compute funding.
export type ChatFinance={now:number;coinId:string;launched:boolean;paused:boolean;fundedMicrousdDaily:number;fundingVerified:boolean;observedAt:number;creditMicrousd:number;questionCeilingMicrousd:number;closedUntil?:number};
const HOUR=3600000;
export function chatWindow(f:ChatFinance):ChatWindow{
 const closed=(reason:ChatWindow["reason"]):ChatWindow=>({open:false,cadence:"closed",durationMinutes:0,closesAt:null,nextOpensAt:null,reason,checkedAt:f.now});
 if(f.paused)return closed("paused");
 if(f.closedUntil&&f.closedUntil>f.now)return closed("agent_closed");
 // Questions are paid from prepaid service credit, so a treasury that dipped
 // below the activation threshold after a top-up does not close chat.
 if(!f.launched||!f.fundingVerified||f.questionCeilingMicrousd<=0||f.creditMicrousd<f.questionCeilingMicrousd)return closed("funding");
 if(f.now-f.observedAt>6*HOUR||f.observedAt>f.now)return closed("stale");
 const fundedQuestions=Math.floor(f.fundedMicrousdDaily/f.questionCeilingMicrousd);
 let cadence:ChatWindow["cadence"]="daily",period=24*HOUR,duration=5,reason:ChatWindow["reason"]="conserving";
 // Only reconciled treasury-to-compute funding changes cadence. Spending and
 // reservation refunds must not masquerade as inflow or create extra sessions.
 if(fundedQuestions>=40){cadence="hourly";period=HOUR;duration=Math.min(20,5+Math.floor(fundedQuestions/20));reason="growing"}
 else if(fundedQuestions>=12){cadence="four-hourly";period=4*HOUR;duration=Math.min(15,5+Math.floor(fundedQuestions/6));reason="steady"}
 else duration=Math.min(10,Math.max(3,Math.floor(fundedQuestions/2)));
 // Stable phase prevents every coin opening together. Schedule derives from trusted
 // finance inputs; browser clocks, messages and proposed schedules are never used.
 let hash=0;for(const c of f.coinId)hash=(hash*31+c.charCodeAt(0))>>>0;
 const offset=(hash%Math.floor(period/60000))*60000;
 const start=Math.floor((f.now-offset)/period)*period+offset;
 const end=start+duration*60000,open=f.now>=start&&f.now<end;
 return {open,cadence,durationMinutes:duration,closesAt:open?end:null,nextOpensAt:open?null:start+period,reason,checkedAt:f.now};
}
// One validation for both availability and metering.
export function chatDailyCap(value:string|undefined){const cap=Number(value);return Number.isSafeInteger(cap)&&cap>0?cap:null;}
