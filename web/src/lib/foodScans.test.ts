import {describe,it,expect,vi,afterEach} from 'vitest';
import {ApiError} from './api';
import {createFoodScanDraft,foodScanDraftForAttempt,getOrCreateFoodScanJob,resumeFoodScanJob,requestFoodScanEstimate,type FoodScanDraft,type FoodScanJob,type ScanApi} from './foodScans';

function draft(overrides:Partial<FoodScanDraft>={}):FoodScanDraft{
  return {version:1,id:'scan-1',date:'2026-09-21',mode:'photo',description:'',imageBase64:'jpeg-data',status:'submitted',...overrides};
}

afterEach(()=>vi.useRealTimers());

describe('recoverable food scan identity',()=>{
  it('stamps a fresh draft with the capture moment, and a delayed retry keeps that original moment',()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-14T09:00:00Z'));
    const created=createFoodScanDraft({date:'2026-10-14',mode:'photo',description:'',imageBase64:'jpeg-data'});
    expect(created.capturedAt).toBe(new Date('2026-10-14T09:00:00Z').getTime());
    vi.setSystemTime(new Date('2026-10-14T14:24:00Z'));
    const input={date:created.date,mode:created.mode,description:created.description,imageBase64:created.imageBase64};
    const resumed=foodScanDraftForAttempt({...created,status:'submitted'},input,()=>'unexpected-id');
    expect(resumed.capturedAt).toBe(created.capturedAt);
  });
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

describe('requestFoodScanEstimate',()=>{
  it('rejects when the scan draft is not ready',async()=>{
    await expect(requestFoodScanEstimate({
      ready:false,currentDraft:null,date:'2026-10-17',mode:'photo',description:'',photo:null,persist:async()=>undefined
    })).rejects.toThrow('Checking saved scan work on this device');
  });

  it('rejects photo or label modes when no photo is attached',async()=>{
    await expect(requestFoodScanEstimate({
      ready:true,currentDraft:null,date:'2026-10-17',mode:'photo',description:'',photo:null,persist:async()=>undefined
    })).rejects.toThrow('Choose a photo before continuing.');
  });

  it('reuses a saved review without re-executing the job',async()=>{
    const currentDraft:FoodScanDraft={
      version:1,id:'scan-review',date:'2026-10-17',mode:'description',description:'eggs',
      imageBase64:null,status:'review',resultJson:JSON.stringify({foods:[{name:'Egg',calories:70,protein:6,fat:5,carbs:0,fiber:0}]})
    };
    const persisted:FoodScanDraft[]=[];
    const resumeJob=vi.fn();
    const result=await requestFoodScanEstimate({
      ready:true,currentDraft,date:'2026-10-17',mode:'description',description:'eggs',photo:null,
      persist:async d=>{persisted.push(d);},resumeJob
    });
    expect(resumeJob).not.toHaveBeenCalled();
    expect(result.estimate.foods[0].name).toBe('Egg');
    expect(persisted).toHaveLength(2);
    expect(persisted[1].status).toBe('review');
  });

  it('resumes a job, parses the estimate, and saves the review status',async()=>{
    const persisted:FoodScanDraft[]=[];
    const resumeJob=vi.fn(async()=>({
      id:'scan-new',status:'complete',resultJson:JSON.stringify({foods:[{name:'Banana',calories:105,protein:1,fat:0,carbs:27,fiber:3}]})
    }));
    const result=await requestFoodScanEstimate({
      ready:true,currentDraft:null,date:'2026-10-17',mode:'description',description:'banana',photo:null,
      persist:async d=>{persisted.push(d);},resumeJob
    });
    expect(resumeJob).toHaveBeenCalledTimes(1);
    expect(result.estimate.foods[0].name).toBe('Banana');
    expect(persisted[0].status).toBe('submitted');
    expect(persisted[1].status).toBe('review');
    expect(persisted[1].imageBase64).toBeNull();
  });

  it('fails when no foods are recognized',async()=>{
    const resumeJob=vi.fn(async()=>({
      id:'scan-empty',status:'complete',resultJson:JSON.stringify({foods:[],explanation:'Unclear image'})
    }));
    await expect(requestFoodScanEstimate({
      ready:true,currentDraft:null,date:'2026-10-17',mode:'description',description:'xyz',photo:null,
      persist:async()=>undefined,resumeJob
    })).rejects.toThrow('Unclear image');
  });
});
