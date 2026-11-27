import {useEffect,useRef} from 'react';
import {Button} from '../ui/Button';

interface StepItem<T extends string>{id:T;label:string}

function scrollBehavior():ScrollBehavior{
  return typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth';
}

/**
 * Step shortcuts for editing an accepted plan. Below 1024 px they sit in one row that scrolls
 * sideways (the current step kept in view) so eight steps never stack into a block of pills;
 * from 1024 px they wrap. Kept outside `.coach-step-progress`, which only reports progress.
 */
export function CoachStepJumps<T extends string>({steps,current,onJump}:{
  steps:readonly StepItem<T>[];
  current:T;
  onJump:(id:T)=>void;
}){
  const rail=useRef<HTMLElement>(null);
  const firstRender=useRef(true);
  useEffect(()=>{
    const active=rail.current?.querySelector<HTMLElement>('[aria-current="step"]');
    if(!active||!rail.current)return;
    // Scroll the rail only, never the page: scrollIntoView would also move the window.
    const railBox=rail.current.getBoundingClientRect();
    const box=active.getBoundingClientRect();
    const offset=box.left-railBox.left-(railBox.width-box.width)/2;
    rail.current.scrollBy({left:offset,behavior:firstRender.current?'instant':scrollBehavior()});
    firstRender.current=false;
  },[current]);
  return <nav ref={rail} className="coach-step-jumps" aria-label="Jump to plan step">
    {steps.map((item,index)=>{
      const isCurrent=item.id===current;
      return <Button
        key={item.id}
        size="sm"
        variant="tertiary"
        className="coach-step-jump"
        aria-current={isCurrent?'step':undefined}
        onClick={()=>{if(!isCurrent)onJump(item.id);}}
      ><span className="coach-step-jump-index" aria-hidden="true">{index+1}</span>{item.label}</Button>;
    })}
  </nav>;
}
