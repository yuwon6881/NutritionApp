/**
 * In-app Back behaviour for the PWA and the Android shell.
 *
 * History holds three kinds of entry:
 * - page entries (`__nourishPage`, `__nourishDepth`) pushed by top-level navigation;
 * - one entry per open Modal (`__nourishModal`, owned by ui/Modal);
 * - at most one guard entry (`__nourishGuard`) while any lighter layer — selection
 *   mode, a dialog step, a popover — wants Back. Layers are consumed innermost first.
 *
 * The URL never changes: hosting only serves the app shell at `/` and `/coach`.
 */
export type HistoryState=Record<string,unknown>;

export interface HistoryPort {
  readonly state:unknown;
  pushState(state:HistoryState,unused:string):void;
  replaceState(state:HistoryState,unused:string):void;
  back():void;
}

export const PAGE_KEY='__nourishPage';
export const DEPTH_KEY='__nourishDepth';
export const MODAL_KEY='__nourishModal';
export const GUARD_KEY='__nourishGuard';

export function readState(port:HistoryPort):HistoryState{
  const state=port.state;
  return state&&typeof state==='object'&&!Array.isArray(state)?{...state as HistoryState}:{};
}

/** True when the current entry belongs to a dialog or layer rather than a page. */
export function isLayerEntry(state:HistoryState){
  return MODAL_KEY in state||GUARD_KEY in state;
}

export function pageDepth(state:HistoryState){
  return typeof state[DEPTH_KEY]==='number'?state[DEPTH_KEY] as number:0;
}

export type HardwareBackAction='history-back'|'home'|'exit';

/** Back unwinds dialogs, layers, then pages; only the Dashboard root leaves the app. */
export function hardwareBackAction(state:Record<string,unknown>):HardwareBackAction{
  if(isLayerEntry(state)||pageDepth(state)>0)return 'history-back';
  const page=state[PAGE_KEY];
  return page===undefined||page==='today'?'exit':'home';
}

export interface BackCoordinator {
  /** Registers the innermost Back handler; returns its removal. */
  register(handler:()=>void):()=>void;
  /** Handles a popstate. Returns true when a layer consumed it. */
  handlePop():boolean;
  /** Records a page change without stacking it on top of a layer entry. */
  pushPage(page:string):void;
  replacePage(page:string):void;
  hasLayers():boolean;
}

export function createBackCoordinator(port:HistoryPort):BackCoordinator{
  const handlers:Array<()=>void>=[];
  let guarded=false;
  let removingGuard=false;

  const pushGuard=()=>{
    port.pushState({...readState(port),[GUARD_KEY]:true},'');
    guarded=true;
  };

  // A layer can register while an earlier guard removal is still travelling
  // through history; that pop re-adds the guard instead of racing it.
  const sync=()=>{
    if(removingGuard)return;
    if(handlers.length&&!guarded)pushGuard();
    else if(!handlers.length&&guarded){
      guarded=false;
      if(GUARD_KEY in readState(port)){
        removingGuard=true;
        port.back();
      }
    }
  };

  return {
    register(handler){
      handlers.push(handler);
      sync();
      return()=>{
        const index=handlers.lastIndexOf(handler);
        if(index>=0)handlers.splice(index,1);
        sync();
      };
    },
    handlePop(){
      if(removingGuard){
        removingGuard=false;
        sync();
        return true;
      }
      const state=readState(port);
      // A Modal entry above the guard was popped; the Modal handles its own entry.
      if(GUARD_KEY in state||!guarded)return false;
      guarded=false;
      const top=handlers.at(-1);
      top?.();
      // A handler that keeps its layer (a protected step) or reveals another keeps Back armed.
      // Removing a layer inside the handler may already have re-armed through sync().
      if(handlers.length&&!guarded)pushGuard();
      return true;
    },
    pushPage(page){
      const state=readState(port);
      const entry={[PAGE_KEY]:page,[DEPTH_KEY]:pageDepth(state)+1};
      if(GUARD_KEY in state){
        // Replacing the guard keeps Back from returning to a layer that is about to unmount.
        port.replaceState(entry,'');
        guarded=false;
      }else port.pushState(entry,'');
    },
    replacePage(page){
      // Browsers keep history state across a reload; a stale dialog or guard
      // key must not make the fresh page look like it has a layer open.
      const state=readState(port);
      port.replaceState({[PAGE_KEY]:page,[DEPTH_KEY]:pageDepth(state)},'');
      guarded=false;
    },
    hasLayers:()=>handlers.length>0,
  };
}

let browserCoordinator:BackCoordinator|null=null;

export function backCoordinator():BackCoordinator{
  if(!browserCoordinator){
    browserCoordinator=createBackCoordinator(window.history);
    window.addEventListener('popstate',()=>{browserCoordinator?.handlePop();});
  }
  return browserCoordinator;
}
