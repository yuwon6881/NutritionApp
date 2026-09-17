import {describe,expect,it} from 'vitest';
import {circularSliderPoint,circularSliderValue,defaultCircularSliderGeometry} from './circularSlider';

describe('circular slider geometry',()=>{
  const geometry=defaultCircularSliderGeometry;
  const point=(angle:number)=>circularSliderPoint(angle,geometry);
  const rect={left:0,top:0,width:geometry.width,height:geometry.height};

  it('maps the ends and midpoint of the clock arc to the value range',()=>{
    expect(circularSliderValue(point(geometry.startAngle),rect,0,100,1,geometry)).toBe(0);
    expect(circularSliderValue(point(geometry.startAngle+geometry.sweep/2),rect,0,100,1,geometry)).toBe(50);
    expect(circularSliderValue(point(geometry.startAngle+geometry.sweep),rect,0,100,1,geometry)).toBe(100);
  });

  it('clamps a pointer in the open part of the arc to the nearest endpoint',()=>{
    expect(circularSliderValue(point(geometry.startAngle-20),rect,0,100,1,geometry)).toBe(0);
    expect(circularSliderValue(point(geometry.startAngle+geometry.sweep+20),rect,0,100,1,geometry)).toBe(100);
  });

  it('snaps accurately to fractional steps for weight adjustments',()=>{
    expect(circularSliderValue(point(geometry.startAngle),rect,55,65,0.1,geometry)).toBe(55);
    expect(circularSliderValue(point(geometry.startAngle+geometry.sweep),rect,55,65,0.1,geometry)).toBe(65);
    const mid=circularSliderValue(point(geometry.startAngle+geometry.sweep/2),rect,55,65,0.1,geometry);
    expect(mid).toBe(60);
  });
});