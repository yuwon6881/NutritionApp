import {describe,expect,it} from 'vitest';
import {dayEnergyPreview} from './dayEnergyPreview';

describe('day energy preview',()=>{
  it('adds the batch to calories already logged and reports what is left',()=>{
    const preview=dayEnergyPreview(1200,450,2000);
    expect(preview).toMatchObject({logged:1200,batch:450,after:1650,target:2000,loggedShare:.6,left:350});
    expect(preview.batchShare).toBeCloseTo(.225);
  });
  it('starts a loaded day without entries from zero',()=>{
    expect(dayEnergyPreview(0,500,2000)).toMatchObject({after:500,loggedShare:0,batchShare:.25,left:1500});
  });
  it('reports the excess once the batch passes the target and keeps the ring within one turn',()=>{
    const preview=dayEnergyPreview(1800,600,2000);
    expect(preview.left).toBe(-400);
    expect(preview.loggedShare).toBe(.9);
    expect(preview.loggedShare!+preview.batchShare!).toBe(1);
    expect(dayEnergyPreview(2500,300,2000).batchShare).toBe(0);
  });
  it('keeps an unknown day or target unknown instead of treating it as zero',()=>{
    expect(dayEnergyPreview(null,450,2000)).toMatchObject({after:null,loggedShare:null,batchShare:null,left:null});
    expect(dayEnergyPreview(1200,450,null)).toMatchObject({after:1650,loggedShare:null,batchShare:null,left:null});
    expect(dayEnergyPreview(1200,450,0).left).toBeNull();
  });
});
