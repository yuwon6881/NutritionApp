import {describe,expect,it} from 'vitest';
import {buildEstimateRequest,confidenceLabel,estimateReadiness,formatRange,inputsSummary,requestSignature,type EstimateSlot} from './bodyFatEstimate';

const saved=(angle:EstimateSlot['angle'],status='complete'):EstimateSlot=>({angle,existing:{id:angle+'-id',status},changed:false,deleted:false});
const picked=(angle:EstimateSlot['angle']):EstimateSlot=>({angle,imageBase64:angle+'-image',changed:true,deleted:false});
const empty=(angle:EstimateSlot['angle']):EstimateSlot=>({angle,changed:false,deleted:false});
const values=(entries:Record<string,string>)=>({neckCm:'',shouldersCm:'',chestCm:'',waistCm:'',hipsCm:'',leftBicepsCm:'',rightBicepsCm:'',leftForearmCm:'',rightForearmCm:'',leftThighCm:'',rightThighCm:'',leftCalfCm:'',rightCalfCm:'',bodyFatPercent:'',...entries});

describe('body-fat estimate readiness',()=>{
  it('needs a usable front, side, and back photo',()=>{
    expect(estimateReadiness([saved('front'),picked('side'),saved('back')],true)).toEqual({ready:true,reason:null});
    expect(estimateReadiness([saved('front'),empty('side'),empty('back')],true)).toEqual({ready:false,reason:'Add side and back photos to estimate.'});
    expect(estimateReadiness([empty('front'),empty('side'),empty('back')],true).reason).toBe('Add front, side, and back photos to estimate.');
  });

  it('does not count a pending upload or a photo marked for deletion',()=>{
    expect(estimateReadiness([saved('front','pending'),saved('side'),saved('back')],true).reason).toBe('Add front photo to estimate.');
    expect(estimateReadiness([{...saved('front'),deleted:true},saved('side'),saved('back')],true).ready).toBe(false);
  });

  it('explains that an estimate needs a connection',()=>{
    expect(estimateReadiness([saved('front'),saved('side'),saved('back')],false)).toEqual({ready:false,reason:'Estimating needs a connection.'});
  });
});

describe('body-fat estimate request',()=>{
  it('sends saved photo identities or new images, and circumferences in centimetres only',()=>{
    const request=buildEstimateRequest('2026-09-28',[saved('front'),picked('side'),saved('back')],values({waistCm:'32',neckCm:'abc',bodyFatPercent:'20'}),'in');
    expect(request).toEqual({
      date:'2026-09-28',
      photos:[{angle:'front',photoId:'front-id'},{angle:'side',imageBase64:'side-image'},{angle:'back',photoId:'back-id'}],
      measurements:{waistCm:81.3}
    });
  });

  it('changes its signature when a photo or measurement changes, not when the date does',()=>{
    const slots=[saved('front'),picked('side'),saved('back')];
    const base=requestSignature(buildEstimateRequest('2026-09-28',slots,values({}),'cm'));
    expect(requestSignature(buildEstimateRequest('2026-09-27',slots,values({}),'cm'))).toBe(base);
    expect(requestSignature(buildEstimateRequest('2026-09-28',slots,values({waistCm:'80'}),'cm'))).not.toBe(base);
    expect(requestSignature(buildEstimateRequest('2026-09-28',[picked('front'),slots[1],slots[2]],values({}),'cm'))).not.toBe(base);
  });
});

describe('body-fat estimate copy',()=>{
  it('formats the range and confidence in plain words',()=>{
    expect(formatRange(15.5,19.5)).toBe('15.5–19.5%');
    expect(confidenceLabel('medium')).toBe('Medium confidence');
  });

  it('names what was used and what was unavailable, never inventing values',()=>{
    expect(inputsSummary({photos:3,heightCm:178,sex:'male',age:32,scaleKg:79.5,trendKg:null,measurementKeys:['waistCm']})).toEqual({
      used:['3 photos','height','sex','age','scale weight','1 measurement'],
      missing:['trend weight']
    });
    expect(inputsSummary({photos:3,heightCm:null,sex:null,age:null,scaleKg:null,trendKg:null,measurementKeys:[]}).missing)
      .toEqual(['height','sex','age','scale weight','trend weight','measurements']);
  });
});
