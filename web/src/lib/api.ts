export class ApiError extends Error { status:number; constructor(message:string,status:number){super(message);this.status=status;} }

export interface ApiFetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  allowNotModified?: boolean;
}

export async function api<T>(path:string,body?:unknown,method?:'GET'|'POST'|'DELETE',options?:ApiFetchOptions):Promise<T>{
  const selectedMethod=method??(body===undefined?'GET':'POST');
  const timeoutSignal=AbortSignal.timeout(path.includes('/process')?120000:20000);
  const signal=options?.signal?(typeof AbortSignal.any==='function'?AbortSignal.any([options.signal,timeoutSignal]):options.signal):timeoutSignal;
  const customHeaders=options?.headers??{};
  const response=await fetch('/api'+path,{
    method:selectedMethod,
    credentials:'same-origin',
    cache:'no-store',
    signal,
    headers:{'Content-Type':'application/json','X-Nutrition-Request':'1',...customHeaders},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  if(response.status===304)return null as T;
  if(!response.ok){
    let message='The service could not complete this request.';
    try{message=(await response.json()).message??message;}catch{/* non-JSON gateway response */}
    throw new ApiError(message,response.status);
  }
  return response.status===204?undefined as T:response.json();
}

export async function apiWithMeta<T>(path:string,options?:ApiFetchOptions & { body?: unknown; method?: 'GET'|'POST'|'DELETE' }):Promise<{ data: T | null; notModified: boolean; etag: string | null }>{
  const selectedMethod=options?.method??(options?.body===undefined?'GET':'POST');
  const timeoutSignal=AbortSignal.timeout(path.includes('/process')?120000:20000);
  const signal=options?.signal?(typeof AbortSignal.any==='function'?AbortSignal.any([options.signal,timeoutSignal]):options.signal):timeoutSignal;
  const customHeaders=options?.headers??{};
  const response=await fetch('/api'+path,{
    method:selectedMethod,
    credentials:'same-origin',
    cache:'no-store',
    signal,
    headers:{'Content-Type':'application/json','X-Nutrition-Request':'1',...customHeaders},
    ...(options?.body===undefined?{}:{body:JSON.stringify(options.body)})
  });
  const etag=response.headers.get('ETag');
  if(response.status===304)return { data: null, notModified: true, etag };
  if(!response.ok){
    let message='The service could not complete this request.';
    try{message=(await response.json()).message??message;}catch{/* non-JSON gateway response */}
    throw new ApiError(message,response.status);
  }
  const data=response.status===204?undefined as T:await response.json();
  return { data, notModified: false, etag };
}
