// OAuth leaves the creation form. Keep only the two editable launch-review
// fields locally; the image, mission and influencer reference are saved server-side.
export function rememberLaunchPreferences(coinId:string,buy:string,tweetUrl:string){
 try{sessionStorage.setItem('shen-launch-review:'+coinId,JSON.stringify({buy,tweetUrl}))}catch{}
}
export function launchPreferences(coinId:string):{buy?:string;tweetUrl?:string}{
 try{const v=JSON.parse(sessionStorage.getItem('shen-launch-review:'+coinId)??'null');return {buy:typeof v?.buy==='string'&&/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(v.buy)?v.buy:undefined,tweetUrl:typeof v?.tweetUrl==='string'&&v.tweetUrl.length<=500?v.tweetUrl:undefined}}catch{return {}}
}
