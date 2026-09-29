import type {Page} from '@playwright/test';

/**
 * Body records served from the browser: the isolated API has no photo bucket, so history and
 * photo bytes are mocked while everything else (session, profile, dialogs) stays real.
 */
const empty={neckCm:null,shouldersCm:null,chestCm:null,waistCm:null,hipsCm:null,leftBicepsCm:null,rightBicepsCm:null,leftForearmCm:null,rightForearmCm:null,leftThighCm:null,rightThighCm:null,leftCalfCm:null,rightCalfCm:null,bodyFatPercent:null};
const record=(id:string,date:string,order:number,angles:string[],measurements:Record<string,number>,kg:number|null)=>({
  id,date,creationOrder:order,revision:2,deleted:false,created:date+'T08:00:00Z',updated:date+'T08:00:00Z',
  measurements:{...empty,...measurements},
  weightContext:kg==null
    ?{scaleKg:null,scaleDate:null,trendKg:null,trendDate:null,capturedAt:null,calculationVersion:null,provenance:'legacy-unavailable'}
    :{scaleKg:kg,scaleDate:date,trendKg:kg-.3,trendDate:date,capturedAt:date+'T08:00:00Z',calculationVersion:'coach-trend-half-life-7d-v1',provenance:'server'},
  photos:angles.map(angle=>({id:`${id}-${angle}`,setId:id,date,angle,bytes:128,status:'complete'}))
});

export const bodyRecords=[
  record('body-newest','2026-09-26',4,['front','side','back'],{neckCm:37.5,waistCm:81,hipsCm:96,bodyFatPercent:18.5},78.4),
  record('body-middle','2026-09-05',3,['front','back'],{neckCm:37.8,waistCm:83.5,bodyFatPercent:20},80.1),
  record('body-measured','2026-08-15',2,[],{waistCm:85,chestCm:102},null),
  record('body-oldest','2026-07-20',1,['front','side','back'],{neckCm:38.2,waistCm:87.2,hipsCm:99,bodyFatPercent:22.3},82.6)
];

export const bodyFatEstimate={
  estimatePercent:17.5,lowPercent:15.5,highPercent:19.5,confidence:'medium',
  explanation:'Upper abdominal outline is visible with some softness at the lower abdomen.',
  cues:['Faint upper abs','Some flank fat'],formulaPercent:16.4,
  inputsUsed:{photos:3,heightCm:170,sex:'female',age:30,scaleKg:78.4,trendKg:null,measurementKeys:['neckCm','waistCm']}
};

// A tiny JPEG-shaped payload; the frame only needs a decodable image response.
const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==','base64');

export async function mockBodyRecords(page:Page,estimate:object|null=bodyFatEstimate){
  const pageBody=JSON.stringify({accountId:'account',revision:1,configured:true,usedBytes:1,maxBytes:2,records:bodyRecords,nextCursor:null,hasMore:false});
  await page.route(/\/api\/body-records(\?.*)?$/,route=>route.request().method()==='GET'?route.fulfill({contentType:'application/json',body:pageBody}):route.continue());
  await page.route(/\/api\/photos\/[^/]+\/content/,route=>route.fulfill({contentType:'image/jpeg',body:jpeg}));
  if(estimate)await page.route('**/api/body-records/body-fat-estimate',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(estimate)}));
}
