import {useCallback,useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {X} from 'lucide-react';
import {Button} from './Button';

export type ModalWidth='sm'|'md'|'lg'|'xl';

export interface ModalProps {
  open:boolean;
  onClose:()=>void;
  title:string;
  description?:string;
  dirty?:boolean;
  width?:ModalWidth;
  closeLabel?:string;
  restoreFocus?:HTMLElement|null;
  /** Fires once after the close transition has completed. */
  onCloseComplete?:()=>void;
  className?:string;
  children:ReactNode;
}

function focusable(root:HTMLElement){
  return [...root.querySelectorAll<HTMLElement>([
    'button:not([disabled]):not([tabindex="-1"])',
    'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
    'select:not([disabled]):not([tabindex="-1"])',
    'textarea:not([disabled]):not([tabindex="-1"])',
    '[href]:not([tabindex="-1"])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(','))].filter(element=>element.getClientRects().length>0);
}

export function Modal({
  open,
  onClose,
  title,
  description,
  dirty=false,
  width='md',
  closeLabel='Close dialog',
  restoreFocus,
  onCloseComplete,
  className='',
  children,
}:ModalProps){
  const dialog=useRef<HTMLDialogElement>(null);
  const previousFocus=useRef<HTMLElement|null>(null);
  const keepEditing=useRef<HTMLButtonElement>(null);
  const confirmation=useRef<HTMLDivElement>(null);
  const confirmationOrigin=useRef<HTMLElement|null>(null);
  const lastEditorFocus=useRef<HTMLElement|null>(null);
  const wasConfirming=useRef(false);
  const onCloseCompleteRef=useRef(onCloseComplete);
  const titleId=useId();
  const descriptionId=useId();
  const [present,setPresent]=useState(open);
  const [phase,setPhase]=useState<'opening'|'open'|'closing'|'closed'>(open?'open':'closed');
  const [confirming,setConfirming]=useState(false);
  const reduceMotion=typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(()=>{onCloseCompleteRef.current=onCloseComplete;},[onCloseComplete]);

  useEffect(()=>{
    if(open){
      if(!present){setPresent(true);return;}
      previousFocus.current=restoreFocus??(document.activeElement instanceof HTMLElement?document.activeElement:null);
      dialog.current?.removeAttribute('data-modal-dismiss-intent');
      setPresent(true);setConfirming(false);setPhase('opening');
      const frame=window.requestAnimationFrame(()=>{
        const element=dialog.current;
        if(!element)return;
        if(!element.open){
          try{element.showModal();}catch{element.setAttribute('open','');/* Keep the controlled surface visible if a browser closes the native dialog during a fast route change. */}
        }
        setPhase('open');
        const target=element.querySelector<HTMLElement>('[data-modal-autofocus]')??focusable(element)[0]??element;
        lastEditorFocus.current=target;
        target.focus({preventScroll:true});
      });
      return()=>window.cancelAnimationFrame(frame);
    }
    if(!present)return;
    setPhase('closing');
    if(document.activeElement instanceof HTMLElement&&dialog.current?.contains(document.activeElement)){
      document.activeElement.blur();
    }
    const timer=window.setTimeout(()=>{
      dialog.current?.close();
      setPresent(false);setConfirming(false);setPhase('closed');
      const target=previousFocus.current;
      const complete=()=>onCloseCompleteRef.current?.();
      if(target?.isConnected){
        window.requestAnimationFrame(()=>{
          target.focus({preventScroll:true});
          complete();
        });
      }else complete();
    },reduceMotion?0:180);
    return()=>window.clearTimeout(timer);
  },[open,present,restoreFocus,reduceMotion]);

  useEffect(()=>{
    if(confirming){
      wasConfirming.current=true;
      const frame=window.requestAnimationFrame(()=>keepEditing.current?.focus({preventScroll:true}));
      return()=>window.cancelAnimationFrame(frame);
    }
    if(wasConfirming.current){
      wasConfirming.current=false;
      const target=confirmationOrigin.current
        ??(lastEditorFocus.current?.isConnected?lastEditorFocus.current:null)
        ??dialog.current?.querySelector<HTMLElement>('[data-modal-autofocus]')
        ??(dialog.current?.querySelector<HTMLElement>('.modal-body')?focusable(dialog.current.querySelector<HTMLElement>('.modal-body')!)[0]:null);
      confirmationOrigin.current=null;
      if(target?.isConnected){
        window.requestAnimationFrame(()=>target.focus({preventScroll:true}));
      }
    }
  },[confirming]);

  const clearDismissIntent=useCallback(()=>dialog.current?.removeAttribute('data-modal-dismiss-intent'),[]);
  const keepEditingAction=useCallback(()=>{
    clearDismissIntent();
    setConfirming(false);
  },[clearDismissIntent]);

  const requestClose=useCallback(()=>{
    if(dirty){
      const active=document.activeElement instanceof HTMLElement?document.activeElement:null;
      const isDismissControl=active?.closest('[data-modal-dismiss]')||active===dialog.current;
      const origin=(!isDismissControl&&active&&dialog.current?.contains(active))
        ? active
        : (lastEditorFocus.current?.isConnected
            ? lastEditorFocus.current
            : (dialog.current?.querySelector<HTMLElement>('[data-modal-autofocus]')??(dialog.current?.querySelector<HTMLElement>('.modal-body')?focusable(dialog.current.querySelector<HTMLElement>('.modal-body')!)[0]:undefined)));
      confirmationOrigin.current=origin??null;
      if(document.activeElement instanceof HTMLElement&&dialog.current?.contains(document.activeElement)){
        document.activeElement.blur();
      }
      setConfirming(true);
      return;
    }
    onClose();
  },[dirty,onClose]);

  const onKeyDown=(event:React.KeyboardEvent<HTMLDialogElement>)=>{
    if(confirming&&event.key==='Escape'){
      event.preventDefault();
      event.stopPropagation();
      keepEditingAction();
      return;
    }
    if(event.key!=='Tab')return;
    const items=focusable(confirming?confirmation.current??event.currentTarget:event.currentTarget);
    if(!items.length){event.preventDefault();event.currentTarget.focus();return;}
    const first=items[0];const last=items[items.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };

  if(!present)return null;
  return <dialog
    ref={dialog}
    className={`modal-shell modal-width-${width} modal-${phase} ${className}`.trim()}
    aria-labelledby={titleId}
    aria-describedby={description?descriptionId:undefined}
    aria-modal="true"
    onCancel={event=>{event.preventDefault();if(confirming)keepEditingAction();else requestClose();}}
    onPointerDownCapture={event=>{
      if(confirming)return;
      const target=event.target;
      if(target instanceof Element&&(target===event.currentTarget||target.closest('[data-modal-dismiss]')))
        dialog.current?.setAttribute('data-modal-dismiss-intent','true');
    }}
    onFocusCapture={event=>{
      if(confirming)return;
      const target=event.target;
      if(target instanceof HTMLElement&&!target.closest('[data-modal-dismiss]')&&!confirmation.current?.contains(target))
        lastEditorFocus.current=target;
    }}
    onKeyDown={onKeyDown}
    onClick={event=>{
      if(confirming)return;
      // A keyboard-activated button can bubble a synthetic click with no useful
      // pointer coordinates. Only the dialog backdrop itself dismisses here;
      // controls inside the surface own their click actions.
      if(event.target===event.currentTarget)requestClose();
    }}
  >
    <div className="modal-surface">
      <div className={`modal-content ${confirming||phase==='closing'?'modal-content-inert':''}`} inert={confirming||phase==='closing'||undefined}>
        <header className="modal-header">
          <div className="modal-heading">
            <h2 id={titleId} tabIndex={-1}>{title}</h2>
            {description&&<p id={descriptionId}>{description}</p>}
          </div>
          <Button data-modal-dismiss variant="tertiary" size="icon" aria-label={closeLabel} onClick={requestClose}><X size={19}/></Button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
      {confirming&&<div ref={confirmation} className="modal-confirmation-layer">
        <div className="modal-confirmation" role="alertdialog" aria-modal="true" aria-labelledby={`${titleId}-confirm-title`} aria-describedby={`${titleId}-confirm-description`}>
          <div>
            <h3 id={`${titleId}-confirm-title`}>Discard changes?</h3>
            <p id={`${titleId}-confirm-description`}>Your entered values will be lost.</p>
          </div>
          <div className="actions">
            <Button ref={keepEditing} onClick={keepEditingAction}>Keep editing</Button>
            <Button variant="destructive" onClick={()=>{clearDismissIntent();confirmationOrigin.current=null;wasConfirming.current=false;setConfirming(false);onClose();}}>Discard changes</Button>
          </div>
        </div>
      </div>}
    </div>
  </dialog>;
}
