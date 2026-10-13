import {memo,useRef,useState,type CSSProperties} from 'react';
import type {BasketLine} from '../lib/foodBasket';
import type {EnergyUnit} from '../types';
import {displayPortion} from '../lib/portions';
import {displayEnergy,energyLabel} from '../lib/units';
import {Button} from './ui/Button';
import {FoodMacroSummary} from './FoodMacroSummary';
import {isExpandedWindow} from '../lib/breakpoints';
import {swipeOffset,settlesOpen} from '../lib/swipeReveal';

const REVEAL_WIDTH=156;

export const BatchFoodRow=memo(function BatchFoodRow({
  line,
  energyUnit,
  open,
  onOpen,
  onEdit,
  onRemove,
}:{
  line:BasketLine;
  energyUnit:EnergyUnit;
  open:boolean;
  onOpen:(open:boolean)=>void;
  onEdit:()=>void;
  onRemove:()=>void;
}){
  const gesture=useRef<{
    id:number;
    startX:number;
    startY:number;
    axis?:'x'|'y';
    dx:number;
  }|undefined>(undefined);
  const suppressClick=useRef(false);
  const [dragOffset,setDragOffset]=useState<number|null>(null);

  const currentOffset=dragOffset??(open?-REVEAL_WIDTH:0);

  return (
    <div
      className={`batch-food${open?' actions-open':''}${dragOffset!==null?' dragging':''}`}
      style={{'--batch-offset':`${currentOffset}px`} as CSSProperties}
    >
      <div
        className="batch-food-summary"
        onPointerDown={event=>{
          if(!event.isPrimary||event.button!==0||isExpandedWindow())return;
          suppressClick.current=false;
          gesture.current={
            id:event.pointerId,
            startX:event.clientX,
            startY:event.clientY,
            dx:0,
          };
        }}
        onPointerMove={event=>{
          const g=gesture.current;
          if(!g||g.id!==event.pointerId)return;
          const dx=event.clientX-g.startX;
          const dy=event.clientY-g.startY;

          if(!g.axis&&Math.max(Math.abs(dx),Math.abs(dy))>=8){
            g.axis=Math.abs(dx)>Math.abs(dy)?'x':'y';
            if(g.axis==='x'){
              try{
                event.currentTarget.setPointerCapture(event.pointerId);
              }catch{}
            }
          }

          if(g.axis!=='x')return;
          g.dx=dx;
          suppressClick.current=true;
          setDragOffset(swipeOffset(dx,open,REVEAL_WIDTH));
        }}
        onPointerUp={event=>{
          const g=gesture.current;
          if(!g||g.id!==event.pointerId)return;
          if(g.axis==='x'){
            try{
              event.currentTarget.releasePointerCapture(event.pointerId);
            }catch{}
            const finalOffset=swipeOffset(g.dx,open,REVEAL_WIDTH);
            onOpen(settlesOpen(finalOffset,REVEAL_WIDTH));
          }
          gesture.current=undefined;
          setDragOffset(null);
        }}
        onPointerCancel={event=>{
          if(gesture.current&&gesture.current.id===event.pointerId){
            try{
              event.currentTarget.releasePointerCapture(event.pointerId);
            }catch{}
            gesture.current=undefined;
            setDragOffset(null);
            suppressClick.current=false;
          }
        }}
        onClick={event=>{
          if(suppressClick.current){
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current=false;
            return;
          }
          if(open){
            onOpen(false);
          }
        }}
      >
        <div className="batch-food-description">
          <strong>{line.name}</strong>
          <small>{displayPortion(line)}{line.source.startsWith('AI')?' · AI estimate':''}</small>
          <FoodMacroSummary className="batch-food-macros" protein={line.protein} carbs={line.carbs} fat={line.fat}/>
        </div>

        <span className="batch-food-energy">
          {displayEnergy(line.calories,energyUnit)} <small>{energyLabel(energyUnit)}</small>
        </span>

        <div className="batch-food-desktop-actions">
          <Button size="sm" variant="secondary" data-batch-actions={line.key} onClick={onEdit}>
            Edit
          </Button>
          <Button size="sm" variant="destructive" aria-label={'Remove '+line.name} onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>

      <div className="batch-food-actions" inert={!open||undefined} aria-hidden={!open}>
        <Button size="sm" variant="secondary" onClick={onEdit} tabIndex={open?0:-1}>
          Edit
        </Button>
        <Button size="sm" variant="destructive" aria-label={'Remove '+line.name} onClick={onRemove} tabIndex={open?0:-1}>
          Remove
        </Button>
      </div>
    </div>
  );
});