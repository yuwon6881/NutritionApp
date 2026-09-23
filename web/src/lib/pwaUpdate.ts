export type PwaUpdateNoticeState=
  | {kind:'none'}
  | {kind:'activated';canReload:boolean};

export function hasUncommittedPwaWork(hasOpenDialog:boolean,hasDirtyInlineForm:boolean):boolean{
  return hasOpenDialog||hasDirtyInlineForm;
}

export function getPwaUpdateNoticeState(reloadPending:boolean,editorOpen:boolean):PwaUpdateNoticeState{
  if(reloadPending)return {kind:'activated',canReload:!editorOpen};
  return {kind:'none'};
}
