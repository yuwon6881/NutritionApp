export class ApiError extends Error { status:number; constructor(message:string,status:number){super(message);this.status=status;} }
export async function api<T>(path:string,body?:unknown):Promise<T>{
  const response=await fetch('/api'+path,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(path.includes('/process')?120000:20000),headers:{'Content-Type':'application/json','X-Nutrition-Request':'1'},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
  if(!response.ok){let message='The service could not complete this request.';try{message=(await response.json()).message??message;}catch{/* non-JSON gateway response */}throw new ApiError(message,response.status);}
  return response.status===204?undefined as T:response.json();
}
