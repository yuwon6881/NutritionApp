import {describe,it,expect,vi} from 'vitest';
import {ApiError} from './api';
import {foodScanDraftForAttempt,getOrCreateFoodScanJob,resumeFoodScanJob,type FoodScanDraft,type FoodScanJob,type ScanApi} from './foodScans';

function draft(overrides:Partial<FoodScanDraft>={}):FoodScanDraft{
  return {version:1,id:'scan-1',date:'2026-09-21',mode:'photo',description:'',imageBase64:'jpeg-data',status:'submitted',...overrides};
}

describe('recoverable food scan identity',()=>{
  it('reuses unresolved request identities but starts a new counted attempt after confirmed AI failure',()=>{
    const submitted=draft({status:'submitted'});
    const input={date:submitted.date,mode:submitted.mode,description:submitted.description,imageBase64:submitted.imageBase64};
    expect(foodScanDraftForAttempt(submitted,input,()=> 'unexpected-id').id).toBe('scan-1');
    const failed=draft({status:'failed',error:'AI processing was interrupted. Try again.'});
    expect(foodScanDraftForAttempt(failed,input,()=> 'scan-2')).toMatchObject({id:'scan-2',status:'captured'});
    const uploadFailed=draft({status:'failed',error:'Upload interrupted. Try again.'});
    expect(foodScanDraftForAttempt(uploadFailed,input,()=> 'scan-2').id).toBe('scan-1');
  });

  it('reuses an existing server job without creating a duplicate',async()=>{
    const request=vi.fn(async<T>(path:string):Promise<T>=>({id:'scan-1',status:'complete',resultJson:'{}'} as T));
    const job=await getOrCreateFoodScanJob(draft(),request as unknown as ScanApi);
    expect(job.id).toBe('scan-1');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/scans/scan-1');
  });

  it('creates only the durable scan identity after a confirmed not-found response',async()=>{
    const request=vi.fn(async<T>(path:string,body?:unknown,method?:'GET'|'POST'|'DELETE'):Promise<T>=>{
      if(path==='/scans/scan-1')throw new ApiError('Not found',404);
      expect(body).toEqual({id:'scan-1',mode:'photo',description:'',imageBase64:'jpeg-data'});
      expect(method).toBe('POST');
      return {id:'scan-1',status:'queued'} as T;
    });
    const job=await getOrCreateFoodScanJob(draft(),request as unknown as ScanApi);
    expect(job).toMatchObject({id:'scan-1',status:'queued'});
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('retries an interrupted upload with the same identity before processing it',async()=>{
    const calls:Array<[string,string|undefined]> = [];
    const request=vi.fn(async<T>(path:string,body?:unknown,method?:'GET'|'POST'|'DELETE'):Promise<T>=>{
      calls.push([path,method]);
      if(path==='/scans/scan-1')return {id:'scan-1',status:'uploading'} as T;
      if(path==='/scans')return {id:'scan-1',status:'queued'} as T;
      if(path==='/scans/scan-1/process')return {id:'scan-1',status:'complete',resultJson:'{"foods":[]}'} as T;
      throw new Error('Unexpected scan request.');
    });
    const job:FoodScanJob=await resumeFoodScanJob(draft(),request as unknown as ScanApi,async()=>undefined);
    expect(job).toMatchObject({id:'scan-1',status:'complete'});
    expect(calls).toEqual([
      ['/scans/scan-1',undefined],
      ['/scans','POST'],
      ['/scans/scan-1/process','POST']
    ]);
  });

  it('does not reprocess a terminal AI failure under the same identity',async()=>{
    const calls:Array<[string,string|undefined]> = [];
    const request=vi.fn(async<T>(path:string,body?:unknown,method?:'GET'|'POST'|'DELETE'):Promise<T>=>{
      calls.push([path,method]);
      if(path==='/scans/scan-1')return {id:'scan-1',status:'failed',error:'AI processing was interrupted. Try again.'} as T;
      throw new Error('Unexpected scan request.');
    });
    const job=await resumeFoodScanJob(draft(),request as unknown as ScanApi,async()=>undefined);
    expect(job.status).toBe('failed');
    expect(calls).toEqual([['/scans/scan-1',undefined]]);
  });

  it('retries only an interrupted upload under its existing identity',async()=>{
    const calls:Array<[string,string|undefined]> = [];
    const request=vi.fn(async<T>(path:string,body?:unknown,method?:'GET'|'POST'|'DELETE'):Promise<T>=>{
      calls.push([path,method]);
      if(path==='/scans/scan-1')return {id:'scan-1',status:'failed',error:'Upload interrupted. Try again.'} as T;
      if(path==='/scans'){
        expect((body as {id:string}).id).toBe('scan-1');
        return {id:'scan-1',status:'queued'} as T;
      }
      if(path==='/scans/scan-1/process')return {id:'scan-1',status:'complete',resultJson:'{"foods":[]}'} as T;
      throw new Error('Unexpected scan request.');
    });
    const job=await resumeFoodScanJob(draft(),request as unknown as ScanApi,async()=>undefined);
    expect(job.status).toBe('complete');
    expect(calls).toEqual([
      ['/scans/scan-1',undefined],
      ['/scans','POST'],
      ['/scans/scan-1/process','POST']
    ]);
  });

  it('asks the server to reclaim an expired processing lease before polling',async()=>{
    const calls:Array<[string,string|undefined]> = [];
    const request=vi.fn(async<T>(path:string,body?:unknown,method?:'GET'|'POST'|'DELETE'):Promise<T>=>{
      calls.push([path,method]);
      if(path==='/scans/scan-1')return {id:'scan-1',status:'processing'} as T;
      if(path==='/scans/scan-1/process')return {id:'scan-1',status:'complete',resultJson:'{"foods":[]}'} as T;
      throw new Error('Unexpected scan request.');
    });
    const job=await resumeFoodScanJob(draft(),request as unknown as ScanApi,async()=>undefined);
    expect(job.status).toBe('complete');
    expect(calls).toEqual([['/scans/scan-1',undefined],['/scans/scan-1/process','POST']]);
  });

  it('does not treat non-not-found API failures as permission to create a second job',async()=>{
    const request=vi.fn(async<T>():Promise<T>=>{throw new ApiError('Unavailable',503);});
    await expect(getOrCreateFoodScanJob(draft(),request as unknown as ScanApi)).rejects.toThrow('Unavailable');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
