import {useRef,useState,type CSSProperties} from 'react';
import {ArrowLeft,MoreHorizontal} from 'lucide-react';
import type {BasketLine} from '../lib/foodBasket';
import type {EnergyUnit} from '../types';
import {displayPortion} from '../lib/portions';
import {displayEnergy,energyLabel} from '../lib/units';
import {Button} from './ui/Button';
import {FoodMacroSummary} from './FoodMacroSummary';

const reveal=166;
export function BatchFoodRow({line,energyUnit,open,onOpen,onEdit,onRemove}:{line:BasketLine;energyUnit:EnergyUnit;open:boolean;onOpen:(open:boolean)=>void;onEdit:()=>void;onRemove:()=>void}){
  const gesture=useRef<{id:number;x:number;y:number;start:number;axis?:'x'|'y';dx:number}|undefined>(undefined);
  const suppressClick=useRef(false);
  const [offset,setOffset]=useState<number|null>(null);
  return <div className={`batch-food${open?' actions-open':''}${offset!==null?' dragging':''}`} style={{'--batch-offset':`${offset??(open?-reveal:0)}px`} as CSSProperties}>
    <div className="batch-food-summary"
      onPointerDown={event=>{
        if(!event.isPrimary||event.button!==0||window.matchMedia('(min-width:1024px)').matches)return;
        suppressClick.current=false;
        gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY,start:open?-reveal:0,dx:0};
      }}
      onPointerMove={event=>{
        const g=gesture.current;if(!g||g.id!==event.pointerId)return;
        const dx=event.clientX-g.x,dy=event.clientY-g.y;
        if(!g.axis&&Math.max(Math.abs(dx),Math.abs(dy))>=10){g.axis=Math.abs(dx)>Math.abs(dy)?'x':'y';if(g.axis==='x'){event.currentTarget.setPointerCapture(event.pointerId);onOpen(open);}}
        if(g.axis!=='x')return;
        g.dx=dx;suppressClick.current=true;setOffset(Math.max(-reveal,Math.min(0,g.start+dx)));
      }}
      onPointerUp={event=>{const g=gesture.current;if(!g||g.id!==event.pointerId)return;if(g.axis==='x')onOpen(g.start===0?g.dx<=-50:g.dx<50);gesture.current=undefined;setOffset(null);}}
      onPointerCancel={()=>{gesture.current=undefined;setOffset(null);suppressClick.current=false;}}
      onClickCapture={event=>{if(suppressClick.current){event.preventDefault();event.stopPropagation();suppressClick.current=false;}}}
    >
      <div className="batch-food-description"><strong>{line.name}</strong><small>{displayPortion(line)}{line.source.startsWith('AI')?' · AI estimate':''}</small><FoodMacroSummary className="batch-food-macros" protein={line.protein} carbs={line.carbs} fat={line.fat}/></div>
      <span className="batch-food-energy">{displayEnergy(line.calories,energyUnit)} <small>{energyLabel(energyUnit)}</small></span>
      <Button className="batch-food-menu" type="button" variant="tertiary" data-batch-actions={line.key} aria-label={'Actions for '+line.name} aria-expanded={open} onClick={()=>onOpen(!open)}><ArrowLeft className="batch-swipe-cue" size={12}/><MoreHorizontal size={18}/></Button>
      <div className="batch-food-desktop-actions"><Button data-batch-actions={line.key} onClick={onEdit}>Edit</Button><Button variant="destructive" aria-label={'Remove '+line.name} onClick={onRemove}>Remove</Button></div>
    </div>
    {open||offset!==null?<div className="batch-food-actions" inert={!open||undefined}><Button onClick={onEdit}>Edit</Button><Button variant="destructive" aria-label={'Remove '+line.name} onClick={onRemove}>Remove</Button></div>:null}
  </div>;
}
