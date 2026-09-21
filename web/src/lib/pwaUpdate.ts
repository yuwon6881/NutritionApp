export type PwaUpdateNoticeState=
  | {kind:'none'}
  | {kind:'waiting';canActivate:boolean}
  | {kind:'activated';canReload:boolean};

export function hasUncommittedPwaWork(hasOpenDialog:boolean,hasDirtyInlineForm:boolean):boolean{
  return hasOpenDialog||hasDirtyInlineForm;
}

export function getPwaUpdateNoticeState(reloadPending:boolean,waiting:boolean,editorOpen:boolean):PwaUpdateNoticeState{
  if(reloadPending)return {kind:'activated',canReload:!editorOpen};
  if(waiting)return {kind:'waiting',canActivate:!editorOpen};
  return {kind:'none'};
}
