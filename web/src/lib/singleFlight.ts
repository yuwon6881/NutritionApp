/** Share overlapping reads only. Callers own account scoping, cancellation, and freshness. */
export function singleFlight<T>(requests:Map<string,Promise<T>>,key:string,read:()=>Promise<T>):Promise<T> {
  const existing=requests.get(key);
  if(existing)return existing;
  const request=read().finally(()=>{if(requests.get(key)===request)requests.delete(key);});
  requests.set(key,request);
  return request;
}
