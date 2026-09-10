export function wait(milliseconds:number):Promise<void>{
  if(milliseconds<=0)return Promise.resolve();
  return new Promise(resolve=>setTimeout(resolve,milliseconds));
}

export async function waitForMinimumDuration(startedAt:number,milliseconds:number):Promise<void>{
  await wait(Math.max(0,milliseconds-(Date.now()-startedAt)));
}
