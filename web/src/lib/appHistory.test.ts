import {describe,expect,it,vi} from 'vitest';
import {createBackCoordinator,hardwareBackAction,GUARD_KEY,MODAL_KEY,PAGE_KEY,DEPTH_KEY,isLayerEntry,type HistoryPort,type HistoryState} from './appHistory';

/** Minimal session history: back() is asynchronous like the browser's. */
function fakeHistory(initial:HistoryState={[PAGE_KEY]:'today',[DEPTH_KEY]:0}){
  const entries:HistoryState[]=[initial];
  let index=0;
  let pendingBacks=0;
  const port:HistoryPort={
    get state(){return entries[index];},
    pushState(state){entries.splice(index+1);entries.push(state);index=entries.length-1;},
    replaceState(state){entries[index]=state;},
    back(){pendingBacks+=1;},
  };
  return {
    port,
    entries:()=>entries.slice(0,index+1),
    /** Delivers queued back() traversals, invoking onPop for each. */
    flush(onPop:()=>void){
      while(pendingBacks>0){pendingBacks-=1;if(index>0){index-=1;onPop();}}
    },
    /** A user pressing Back. */
    userBack(onPop:()=>void){if(index>0){index-=1;onPop();}},
  };
}

describe('back coordinator',()=>{
  it('arms one guard for nested layers and consumes them innermost first',()=>{
    const history=fakeHistory();
    const coordinator=createBackCoordinator(history.port);
    const outer=vi.fn();
    const inner=vi.fn();
    const removeOuter=coordinator.register(outer);
    const removeInner=coordinator.register(inner);
    expect(history.entries().filter(entry=>GUARD_KEY in entry)).toHaveLength(1);

    inner.mockImplementation(()=>removeInner());
    history.userBack(()=>coordinator.handlePop());
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    // The outer layer is still open, so Back stays armed.
    expect(GUARD_KEY in (history.port.state as HistoryState)).toBe(true);

    outer.mockImplementation(()=>removeOuter());
    history.userBack(()=>coordinator.handlePop());
    expect(outer).toHaveBeenCalledTimes(1);
    expect(history.port.state).toEqual({[PAGE_KEY]:'today',[DEPTH_KEY]:0});
    expect(coordinator.hasLayers()).toBe(false);
  });

  it('removes its guard when the last layer closes without Back',()=>{
    const history=fakeHistory();
    const coordinator=createBackCoordinator(history.port);
    const remove=coordinator.register(()=>{});
    remove();
    const popsSeenByLayers:boolean[]=[];
    history.flush(()=>popsSeenByLayers.push(coordinator.handlePop()));
    expect(popsSeenByLayers).toEqual([true]);
    expect(history.entries()).toEqual([{[PAGE_KEY]:'today',[DEPTH_KEY]:0}]);
  });

  it('re-arms when a layer opens while the previous guard is still being removed',()=>{
    const history=fakeHistory();
    const coordinator=createBackCoordinator(history.port);
    coordinator.register(()=>{})();
    const next=vi.fn();
    coordinator.register(next);
    history.flush(()=>coordinator.handlePop());
    expect(GUARD_KEY in (history.port.state as HistoryState)).toBe(true);
    history.userBack(()=>coordinator.handlePop());
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('keeps Back armed when a handler declines to close its layer',()=>{
    const history=fakeHistory();
    const coordinator=createBackCoordinator(history.port);
    const protectedLayer=vi.fn();
    coordinator.register(protectedLayer);
    history.userBack(()=>coordinator.handlePop());
    expect(protectedLayer).toHaveBeenCalledTimes(1);
    expect(GUARD_KEY in (history.port.state as HistoryState)).toBe(true);
  });

  it('leaves a Modal entry above the guard to the Modal',()=>{
    const history=fakeHistory();
    const coordinator=createBackCoordinator(history.port);
    const layer=vi.fn();
    coordinator.register(layer);
    history.port.pushState({...(history.port.state as HistoryState),[MODAL_KEY]:'m1'},'');
    history.userBack(()=>coordinator.handlePop());
    expect(layer).not.toHaveBeenCalled();
    expect(GUARD_KEY in (history.port.state as HistoryState)).toBe(true);
  });

  it('stacks page entries with increasing depth and replaces a guard instead of stacking on it',()=>{
    const history=fakeHistory();
    const coordinator=createBackCoordinator(history.port);
    coordinator.pushPage('food');
    expect(history.port.state).toEqual({[PAGE_KEY]:'food',[DEPTH_KEY]:1});
    coordinator.register(()=>{});
    coordinator.pushPage('progress');
    expect(history.entries()).toEqual([
      {[PAGE_KEY]:'today',[DEPTH_KEY]:0},
      {[PAGE_KEY]:'food',[DEPTH_KEY]:1},
      {[PAGE_KEY]:'progress',[DEPTH_KEY]:2},
    ]);
  });

  it('identifies dialog and layer entries',()=>{
    expect(isLayerEntry({[MODAL_KEY]:'x'})).toBe(true);
    expect(isLayerEntry({[GUARD_KEY]:true})).toBe(true);
    expect(isLayerEntry({[PAGE_KEY]:'food'})).toBe(false);
  });

  it('unwinds dialogs and pages with hardware Back and exits only from the Dashboard root',()=>{
    expect(hardwareBackAction({[PAGE_KEY]:'today',[DEPTH_KEY]:0,[MODAL_KEY]:'m'})).toBe('history-back');
    expect(hardwareBackAction({[PAGE_KEY]:'food',[DEPTH_KEY]:0,[GUARD_KEY]:true})).toBe('history-back');
    expect(hardwareBackAction({[PAGE_KEY]:'progress',[DEPTH_KEY]:2})).toBe('history-back');
    expect(hardwareBackAction({[PAGE_KEY]:'coach',[DEPTH_KEY]:0})).toBe('home');
    expect(hardwareBackAction({[PAGE_KEY]:'today',[DEPTH_KEY]:0})).toBe('exit');
    expect(hardwareBackAction({})).toBe('exit');
  });
});

describe('back coordinator after a reload',()=>{
  it('drops stale dialog and guard keys when recording the first page',()=>{
    const history=fakeHistory({[PAGE_KEY]:'food',[DEPTH_KEY]:3,[MODAL_KEY]:'stale',[GUARD_KEY]:true});
    const coordinator=createBackCoordinator(history.port);
    coordinator.replacePage('today');
    expect(history.port.state).toEqual({[PAGE_KEY]:'today',[DEPTH_KEY]:3});
    expect(isLayerEntry(history.port.state as HistoryState)).toBe(false);
  });
});
