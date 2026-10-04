// HTTP-mapped error, shared by modules that cannot import lib/server.
export class AppError extends Error{status:number;constructor(status:number,message:string){super(message);this.status=status}}
