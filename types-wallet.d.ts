type EthereumProvider={request:(args:{method:string;params?:unknown[]})=>Promise<unknown>;on?:(event:string,listener:(v:unknown)=>void)=>void;removeListener?:(event:string,listener:(v:unknown)=>void)=>void};
interface Window{ethereum?:EthereumProvider}
