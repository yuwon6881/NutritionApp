import {lazy,Suspense,useState,type ComponentProps} from 'react';
import type {AiAssistantPanel as Panel} from './AiAssistantPanel';
import {Modal} from './ui/Modal';
import './AiAssistantLauncher.css';

export const warmAiAssistant=()=>import('./AiAssistantPanel');
const AiAssistantPanel=lazy(()=>warmAiAssistant().then(module=>({default:module.AiAssistantPanel})));

/** Show the dialog immediately even when the offline chunk has not loaded yet. */
export function AiAssistantLauncher(props:Omit<ComponentProps<typeof Panel>,'headerTarget'>){
  const [headerTarget,setHeaderTarget]=useState<HTMLSpanElement|null>(null);
  return <Modal open={props.isOpen} title="Ask AI" description="Nutrition assistant" width="lg" className="ai-assistant-modal" onClose={props.onClose}
    headerActions={<span ref={setHeaderTarget}/>}>
    <Suspense fallback={<p className="ai-assistant-opening" role="status">Loading conversation…</p>}>
      {props.isOpen&&<AiAssistantPanel {...props} headerTarget={headerTarget}/>}
    </Suspense>
  </Modal>;
}
