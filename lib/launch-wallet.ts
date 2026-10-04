// The extension's selected account and QI's signed-in session are separate.
// Check both before asking for any launch authorization signature.
export async function verifyLaunchWallet(account:string,transport:typeof fetch=fetch){
 const result=await transport('/api/auth',{cache:'no-store'});
 if(!result.ok)throw Error('Could not verify your wallet session. Sign in again before launching.');
 const data=await result.json() as {user?:{userId?:string}|null};
 const owner=data.user?.userId;
 if(!owner)throw Error('Sign in with the wallet that created this launch plan, then reopen it from My agents.');
 if(owner.toLowerCase()!==account.toLowerCase())throw Error('Your selected wallet differs from your QI sign-in. Select the wallet that created this draft, sign in again, and reopen it from My agents.');
}
