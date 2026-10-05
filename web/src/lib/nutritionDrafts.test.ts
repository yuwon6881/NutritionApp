import {beforeEach,expect,it,vi} from 'vitest';
import type {BodyDraft,LocalData} from '../types';
import {api,ApiError} from './api';
import {uploadPendingDrafts} from './nutritionDraftUpload';
vi.mock('./api',()=>({api:vi.fn(),ApiError:class extends Error{constructor(message:string,public status:number,public retryAfterMs:number|null=null){super(message);}}}));
const draft:BodyDraft={id:'body',date:'2026-09-10',mutationId:'save',expectedRevision:0,photos:[],measurements:{waistCm:80}};
function runner(drafts:BodyDraft[]){
  let data={bodyDrafts:drafts} as LocalData;
  const expireSession=vi.fn();
  const options={isAlive:()=>true,getDrafts:()=>data,commit:async(change:(data:LocalData)=>LocalData)=>{data=change(data);},beginSync:vi.fn(),finishSync:vi.fn(),setError:vi.fn(),expireSession};
  return {options,get:()=>data,set:(next:BodyDraft[])=>{data={...data,bodyDrafts:next};}};
}
beforeEach(()=>vi.clearAllMocks());
it('keeps transient failures retryable and stops the pass on expired sessions',async()=>{
  const r=runner([draft]);vi.mocked(api).mockRejectedValueOnce(new ApiError('Unavailable',503));
  await uploadPendingDrafts(r.options);
  expect(r.get().bodyDrafts?.[0].error).toBeUndefined();
  r.set([draft,{...draft,id:'other',mutationId:'second'}]);vi.mocked(api).mockRejectedValueOnce(new ApiError('Expired',401));
  await uploadPendingDrafts(r.options);expect(r.options.expireSession).toHaveBeenCalledOnce();
  expect(api).toHaveBeenCalledTimes(2);expect(r.get().bodyDrafts).toHaveLength(2);
});
it('checkpoints photo deletions and resumes without changing previously sent requests',async()=>{
  const r=runner([{...draft,serverRevision:5,steps:[{path:'/body-records/body',input:{id:'save',expectedRevision:0},revision:5}],deletePhotoIds:['a','b','c'],deleteMutationIds:{a:'da',b:'db',c:'dc'}}]);
  vi.mocked(api).mockResolvedValueOnce({revision:6}).mockResolvedValueOnce({revision:7}).mockRejectedValueOnce(new ApiError('Unavailable',503));
  await uploadPendingDrafts(r.options);
  r.set(r.get().bodyDrafts!.map(item=>({...item,retryAt:0,error:undefined})));
  vi.mocked(api).mockResolvedValueOnce({revision:8});await uploadPendingDrafts(r.options);
  expect(api).toHaveBeenCalledTimes(4);
  expect(vi.mocked(api).mock.calls[3][1]).toMatchObject({id:'dc',expectedRevision:7});
  expect(r.get().bodyDrafts).toEqual([]);
});
it('does not acknowledge a newer draft using an older upload result',async()=>{
  const r=runner([draft]);
  vi.mocked(api).mockImplementationOnce(async()=>{r.set([draft,{...draft,mutationId:'new',measurements:{waistCm:81}}]);return {revision:1};});
  await uploadPendingDrafts(r.options);
  expect(r.get().bodyDrafts).toHaveLength(1);expect(r.get().bodyDrafts?.[0].mutationId).toBe('new');
});

it('replays an unchanged root request after a lost response and rebases the next draft',async()=>{
  const r=runner([draft,{...draft,mutationId:'second',expectedRevision:0,measurements:{waistCm:81}}]);
  vi.mocked(api).mockRejectedValueOnce(new ApiError('Lost response',503));await uploadPendingDrafts(r.options);
  const original=vi.mocked(api).mock.calls[0][1];r.set(r.get().bodyDrafts!.map(item=>({...item,retryAt:0})));
  vi.mocked(api).mockResolvedValueOnce({revision:1}).mockResolvedValueOnce({revision:2});await uploadPendingDrafts(r.options);
  expect(vi.mocked(api).mock.calls[1][1]).toEqual(original);
  expect(vi.mocked(api).mock.calls[2][1]).toMatchObject({id:'second',expectedRevision:1});expect(r.get().bodyDrafts).toEqual([]);
});

it('retains legacy ambiguous partial drafts for review without issuing replacement requests',async()=>{
  const r=runner([{...draft,serverRevision:5,deletePhotoIds:['a'],deleteMutationIds:{a:'unknown-request'}}]);
  await uploadPendingDrafts(r.options);expect(api).not.toHaveBeenCalled();
  expect(r.get().bodyDrafts?.[0].error).toContain('needs review');expect(r.get().bodyDrafts).toHaveLength(1);
});
