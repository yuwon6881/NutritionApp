export interface NutritionReminderPayload{
  route:string;
}

function isObject(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null;}

export function parseNutritionReminderPayload(value:unknown,origin:string):NutritionReminderPayload|null{
  const envelope=isObject(value)?value:null;
  const data=envelope&&isObject(envelope.data)?envelope.data:envelope;
  if(!data||data.kind!=='check-in')return null;
  if(typeof data.route!=='string')return {route:'/'};
  try{
    const destination=new URL(data.route,origin);
    return {route:destination.origin===origin?destination.pathname+destination.search+destination.hash:'/'};
  }catch{return {route:'/'};}
}
