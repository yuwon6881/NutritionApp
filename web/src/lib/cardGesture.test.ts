import {describe,expect,it} from 'vitest';
import {idleCardGesture,stepCardGesture,type CardGestureEvent,type CardGestureEffect} from './cardGesture';

function run(events:CardGestureEvent[]):CardGestureEffect[]{
  let state=idleCardGesture;
  return events.map(event=>{
    const result=stepCardGesture(state,event);
    state=result.state;
    return result.effect;
  });
}

const touchDown:CardGestureEvent={type:'down',pointerType:'touch',x:100,y:100};
const mouseDown:CardGestureEvent={type:'down',pointerType:'mouse',x:100,y:100};

describe('card gesture',()=>{
  it('selects when a touch is held still and released',()=>{
    expect(run([touchDown,{type:'move',x:103,y:102},{type:'hold'},{type:'up'}]))
      .toEqual(['start-hold-timer','none','lift','select']);
  });

  it('drags when a held touch moves after lifting',()=>{
    expect(run([touchDown,{type:'hold'},{type:'move',x:100,y:130},{type:'move',x:100,y:160},{type:'up'}]))
      .toEqual(['start-hold-timer','lift','begin-drag','track','drop']);
  });

  it('keeps a lifted card selectable through small finger tremor',()=>{
    expect(run([touchDown,{type:'hold'},{type:'move',x:104,y:104},{type:'up'}]))
      .toEqual(['start-hold-timer','lift','none','select']);
  });

  it('abandons the gesture so the page can scroll when a touch moves before the hold',()=>{
    const effects=run([touchDown,{type:'move',x:100,y:120},{type:'hold'},{type:'up'}]);
    expect(effects).toEqual(['start-hold-timer','abort','none','none']);
  });

  it('swipes when a touch moves clearly sideways before the hold',()=>{
    expect(run([touchDown,{type:'move',x:80,y:102},{type:'move',x:40,y:103},{type:'hold'},{type:'up'}]))
      .toEqual(['start-hold-timer','begin-swipe','swipe-track','none','swipe-end']);
  });

  it('keeps a diagonal flick as a scroll rather than a swipe',()=>{
    expect(run([touchDown,{type:'move',x:90,y:88}])).toEqual(['start-hold-timer','abort']);
  });

  it('never swipes with a mouse; sideways mouse movement drags',()=>{
    expect(run([mouseDown,{type:'move',x:80,y:100}])).toEqual(['none','begin-drag']);
  });

  it('treats a quick tap as no gesture',()=>{
    expect(run([touchDown,{type:'up'}])).toEqual(['start-hold-timer','abort']);
  });

  it('starts a mouse drag after the movement tolerance without a hold',()=>{
    expect(run([mouseDown,{type:'move',x:104,y:100},{type:'move',x:110,y:100},{type:'move',x:110,y:140},{type:'up'}]))
      .toEqual(['none','none','begin-drag','track','drop']);
  });

  it('never selects with a mouse hold',()=>{
    expect(run([mouseDown,{type:'hold'},{type:'up'}])).toEqual(['none','none','abort']);
  });

  it('aborts from any active phase on cancel and ignores cancel when idle',()=>{
    expect(run([touchDown,{type:'hold'},{type:'cancel'}])).toEqual(['start-hold-timer','lift','abort']);
    expect(run([touchDown,{type:'hold'},{type:'move',x:100,y:140},{type:'cancel'}])).toEqual(['start-hold-timer','lift','begin-drag','abort']);
    expect(run([{type:'cancel'}])).toEqual(['none']);
  });
});
