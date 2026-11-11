export type PwaUpdateNoticeState=
  | {kind:'none'}
  | {kind:'activated';canReload:boolean};

export function hasUncommittedPwaWork(hasOpenDialog:boolean,hasDirtyInlineForm:boolean):boolean{
  return hasOpenDialog||hasDirtyInlineForm;
}

/**
 * A launch route (App Link, notification tap) waits for sign-in, which a sleeping server can delay
 * for many seconds. By then the user may have opened a dialog and taken a photo; navigating would
 * close it and lose the work. Only a route applied after such a wait yields to open work: a tap
 * received while the app is already ready is an explicit request and always navigates.
 */
export function deferredRouteToApply(route:string|null,deferred:boolean,workInProgress:boolean):string|null{
  if(!route)return null;
  return deferred&&workInProgress?null:route;
}

export function getPwaUpdateNoticeState(reloadPending:boolean,editorOpen:boolean):PwaUpdateNoticeState{
  if(reloadPending)return {kind:'activated',canReload:!editorOpen};
  return {kind:'none'};
}
