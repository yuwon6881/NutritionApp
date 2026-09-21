import {describe,it,expect} from 'vitest';
import {getPwaUpdateNoticeState,hasUncommittedPwaWork} from './pwaUpdate';
import {summarizePwaPendingWork} from './pwaReadiness';
import {parseNutritionReminderPayload} from './push/pushPayload';

describe('safe PWA update recovery',()=>{
  it('shows an explicit reload action after activation instead of reloading sibling tabs',()=>{
    expect(getPwaUpdateNoticeState(true,false,false)).toEqual({kind:'activated',canReload:true});
    expect(getPwaUpdateNoticeState(true,false,true)).toEqual({kind:'activated',canReload:false});
  });

  it('blocks the reload action for dirty inline reminder settings as well as open dialogs',()=>{
    expect(hasUncommittedPwaWork(false,true)).toBe(true);
    expect(getPwaUpdateNoticeState(true,false,hasUncommittedPwaWork(false,true)))
      .toEqual({kind:'activated',canReload:false});
    expect(hasUncommittedPwaWork(false,false)).toBe(false);
  });

  it('includes durable scan uploads in saved-work status and never shows all-clear while checking fails',()=>{
    expect(summarizePwaPendingWork(1,0,0,0,2)).toMatchObject({total:3,complete:true,scanDraftCount:2});
    expect(summarizePwaPendingWork(0,0,0,0,null)).toMatchObject({total:0,complete:false});
    expect(summarizePwaPendingWork(0,0,0,0,-1)).toMatchObject({total:0,complete:false,scanCountFailed:true});
  });

  it('recovers only generic check-in pushes and constrains their route to this application',()=>{
    expect(parseNutritionReminderPayload({data:{kind:'check-in',route:'/diary?date=2026-09-21'}},'https://nutrition.example'))
      .toEqual({route:'/diary?date=2026-09-21'});
    expect(parseNutritionReminderPayload({kind:'check-in',route:'https://other.example/private'},'https://nutrition.example'))
      .toEqual({route:'/'});
    expect(parseNutritionReminderPayload({data:{kind:'transaction',route:'/'}},'https://nutrition.example')).toBeNull();
  });
});
