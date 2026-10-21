const key=(userId:string,deviceId:string)=>`nutrition-push-opt-out:${userId}:${deviceId}`;

/** Remembers that this account turned notifications off on this device, so nothing re-subscribes it behind that choice. */
export function setDevicePushOptOut(userId:string,deviceId:string,optedOut:boolean){
  try{
    if(optedOut)localStorage.setItem(key(userId,deviceId),'1');
    else localStorage.removeItem(key(userId,deviceId));
  }catch{/* Without storage the device simply is not re-subscribed automatically next time it is turned off. */}
}

export function hasDevicePushOptOut(userId:string,deviceId:string){
  try{return localStorage.getItem(key(userId,deviceId))!==null;}
  catch{return true;}
}
