/** Coalesce pointer samples, while release/keyboard actions can flush immediately. */
export function frameTask<T>(apply:(value:T)=>void) {
  let frame:number|undefined;
  let pending:T|undefined;
  let hasPending=false;
  const cancel=()=>{
    if(frame!==undefined)cancelAnimationFrame(frame);
    frame=undefined;pending=undefined;hasPending=false;
  };
  const flush=()=>{
    if(!hasPending)return;
    const value=pending as T;
    cancel();
    apply(value);
  };
  return {
    schedule:(value:T)=>{pending=value;hasPending=true;if(frame===undefined)frame=requestAnimationFrame(flush);},
    flush,cancel
  };
}
