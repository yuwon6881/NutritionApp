export interface PwaPendingWorkSummary{
  total:number;
  needsReview:number;
  scanDraftCount:number|null;
  scanCountFailed:boolean;
  complete:boolean;
}

export function summarizePwaPendingWork(
  queuedMutations:number,
  photoDrafts:number,
  bodyDrafts:number,
  needsReview:number,
  scanDraftCount:number|null
):PwaPendingWorkSummary{
  const scanCountFailed=scanDraftCount!=null&&scanDraftCount<0;
  return {
    total:queuedMutations+photoDrafts+bodyDrafts+(scanDraftCount!=null&&scanDraftCount>0?scanDraftCount:0),
    needsReview,
    scanDraftCount,
    scanCountFailed,
    complete:scanDraftCount!=null&&!scanCountFailed,
  };
}
