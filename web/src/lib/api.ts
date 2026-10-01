import {fetchWithAvailabilityRecovery} from './availabilityRecovery';

const recoverablePath=(path:string)=>['/auth/me','/bootstrap','/training/summary','/integrations/google-health/sync'].includes(path.split('?')[0]);

export class ApiError extends Error {
  constructor(message:string, public status:number, public retryAfterMs:number|null=null, public retryAt:number|null=null){super(message);}
}

const cooldowns=new Map<string,{retryAt:number;message:string}>();
export function clearApiCooldowns(){cooldowns.clear();}

function rateLimitKey(path:string){
  if(path.startsWith('/foods/search')||path.startsWith('/foods/barcode/'))return 'food-lookup';
  if(path==='/scans'||/^\/scans\/[^/]+\/process$/.test(path))return 'scans';
  return path.split('?')[0];
}

function checkCooldown(path:string){
  const key=rateLimitKey(path);
  const cooldown=cooldowns.get(key);
  if(!cooldown)return;
  const remaining=cooldown.retryAt-Date.now();
  if(remaining>0)throw new ApiError(cooldown.message+` Retry in ${Math.ceil(remaining/1000)} seconds.`,429,remaining,cooldown.retryAt);
  cooldowns.delete(key);
}

async function responseError(path:string,response:Response):Promise<never>{
  let message=[429,502,503,504].includes(response.status)?'The service is temporarily unavailable. Try again shortly.':'The service could not complete this request.';
  try{message=(await response.json()).message??message;}catch{/* non-JSON gateway response */}
  if(response.status!==429)throw new ApiError(message,response.status);
  const raw=response.headers.get('Retry-After');
  const seconds=raw!==null&&/^\d+$/.test(raw)?Number(raw):null;
  const parsedDate=raw!==null?Date.parse(raw):NaN;
  const retryAfterMs=seconds!==null?seconds*1000:Number.isFinite(parsedDate)?Math.max(0,parsedDate-Date.now()):recoverablePath(path)?5000:60000;
  const retryAt=Date.now()+retryAfterMs;
  cooldowns.set(rateLimitKey(path),{retryAt,message});
  throw new ApiError(message,429,retryAfterMs,retryAt);
}

// AI work (scan processing, body-fat estimates) outlives the ordinary request budget.
const requestTimeoutMs=(path:string)=>path.includes('/process')||path.endsWith('/body-fat-estimate')?120000:20000;

export interface ApiFetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  allowNotModified?: boolean;
}

export async function api<T>(path:string,body?:unknown,method?:'GET'|'POST'|'DELETE',options?:ApiFetchOptions):Promise<T>{
  checkCooldown(path);
  const selectedMethod=method??(body===undefined?'GET':'POST');

  const signal=options?.signal;
  const customHeaders=options?.headers??{};
  const response=await fetchWithAvailabilityRecovery('/api'+path,{
    method:selectedMethod,
    credentials:'same-origin',
    cache:'no-store',
    signal,
    headers:{'Content-Type':'application/json','X-Nutrition-Request':'1',...customHeaders},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  },recoverablePath(path),requestTimeoutMs(path));
  if(response.status===304)return null as T;
  if(!response.ok){
    await responseError(path,response);
  }
  return response.status===204?undefined as T:response.json();
}

export async function apiWithMeta<T>(path:string,options?:ApiFetchOptions & { body?: unknown; method?: 'GET'|'POST'|'DELETE' }):Promise<{ data: T | null; notModified: boolean; etag: string | null }>{
  checkCooldown(path);
  const selectedMethod=options?.method??(options?.body===undefined?'GET':'POST');

  const signal=options?.signal;
  const customHeaders=options?.headers??{};
  const response=await fetchWithAvailabilityRecovery('/api'+path,{
    method:selectedMethod,
    credentials:'same-origin',
    cache:'no-store',
    signal,
    headers:{'Content-Type':'application/json','X-Nutrition-Request':'1',...customHeaders},
    ...(options?.body===undefined?{}:{body:JSON.stringify(options.body)})
  },recoverablePath(path),requestTimeoutMs(path));
  const etag=response.headers.get('ETag');
  if(response.status===304)return { data: null, notModified: true, etag };
  if(!response.ok){
    await responseError(path,response);
  }
  const data=response.status===204?undefined as T:await response.json();
  return { data, notModified: false, etag };
}
