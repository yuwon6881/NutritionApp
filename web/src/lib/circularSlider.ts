export interface CircularSliderGeometry{
  width:number;
  height:number;
  centerX:number;
  centerY:number;
  radius:number;
  startAngle:number;
  sweep:number;
}

export const defaultCircularSliderGeometry:CircularSliderGeometry={
  width:240,
  height:174,
  centerX:120,
  centerY:112,
  radius:80,
  startAngle:135,
  sweep:270
};

export function circularSliderPoint(angle:number,geometry=defaultCircularSliderGeometry){
  const radians=angle*Math.PI/180;
  return {
    x:geometry.centerX+geometry.radius*Math.cos(radians),
    y:geometry.centerY+geometry.radius*Math.sin(radians)
  };
}

export function circularSliderValue(
  point:{x:number;y:number},
  rect:{left:number;top:number;width:number;height:number},
  min:number,
  max:number,
  step:number,
  geometry=defaultCircularSliderGeometry
){
  if(rect.width<=0||rect.height<=0)return min;
  const x=(point.x-rect.left)/rect.width*geometry.width;
  const y=(point.y-rect.top)/rect.height*geometry.height;
  const angle=(Math.atan2(y-geometry.centerY,x-geometry.centerX)*180/Math.PI+360)%360;
  const offset=(angle-geometry.startAngle+360)%360;
  const arcOffset=offset<=geometry.sweep
    ?offset
    :360-offset<=offset-geometry.sweep?0:geometry.sweep;
  const raw=min+(arcOffset/geometry.sweep)*(max-min);
  const clamped=Math.min(Math.max(raw,min),max);
  const snapped=min+Math.round((clamped-min)/step)*step;
  return Number(Math.min(Math.max(snapped,min),max).toFixed(6));
}