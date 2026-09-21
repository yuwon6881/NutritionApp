const DEVICE_ID_STORAGE_KEY='nourish-push-device-id';

function generateUuid(){
  if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,char=>{
    const random=Math.floor(Math.random()*16);
    return (char==='x'?random:(random&0x3)|0x8).toString(16);
  });
}

/** A random per-browser id, never derived from the signed-in account. */
export function getOrCreatePushDeviceId(){
  try{
    const existing=localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if(existing)return existing;
    const created=generateUuid();
    localStorage.setItem(DEVICE_ID_STORAGE_KEY,created);
    return created;
  }catch{
    return generateUuid();
  }
}
