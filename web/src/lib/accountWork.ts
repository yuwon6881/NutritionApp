
type WorkMessage={account:string};
let channel:BroadcastChannel|undefined;
function workChannel(){
  if(typeof window==='undefined'||typeof BroadcastChannel==='undefined')return undefined;
  return channel??=new BroadcastChannel('nutrition-retained-work');
}
export function publishAccountWork(account:string){workChannel()?.postMessage({account} satisfies WorkMessage);}
export function subscribeAccountWork(account:string,refresh:()=>void){
  const listener=(event:MessageEvent<WorkMessage>)=>{if(event.data?.account===account)refresh();};
  const current=workChannel();current?.addEventListener('message',listener);
  return ()=>current?.removeEventListener('message',listener);
}

export async function acquireAccountDispatch(account:string){
  const dispatcher=await import('./accountDispatch');return dispatcher.acquireAccountDispatch(account);
}
