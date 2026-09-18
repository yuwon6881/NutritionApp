import {Clipboard,ClipboardPaste,X} from 'lucide-react';
import type {FoodClipboard} from '../lib/useFoodClipboard';
import {Button} from './ui/Button';
import {displayEnergy,energyLabel,type EnergyUnit} from '../lib/units';

export interface FoodClipboardBannerProps {
  clipboard:FoodClipboard;
  currentDate:string;
  viewDate:string;
  energyUnit?:EnergyUnit;
  onPasteToDay:()=>void;
  onClear:()=>void;
  disabled?:boolean;
}

export function FoodClipboardBanner({
  clipboard,
  currentDate,
  viewDate,
  energyUnit='kcal',
  onPasteToDay,
  onClear,
  disabled=false,
}:FoodClipboardBannerProps){
  const count=clipboard.entries.length;
  if(count===0)return null;

  const totalCalories=clipboard.entries.reduce((sum,e)=>sum+e.calories,0);
  const targetLabel=viewDate===currentDate?'Today':viewDate;
  const sourceLabel=clipboard.sourceDate===currentDate?'Today':clipboard.sourceDate;

  return (
    <div className="food-clipboard-banner" role="region" aria-label="Food clipboard">
      <div className="food-clipboard-banner-main">
        <Clipboard size={18} className="food-clipboard-icon" aria-hidden="true"/>
        <div className="food-clipboard-text">
          <strong>{count} {count===1?'food':'foods'} copied</strong>
          <span>({displayEnergy(totalCalories,energyUnit)} {energyLabel(energyUnit)}) from {sourceLabel}</span>
        </div>
      </div>
      <div className="food-clipboard-banner-actions">
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={onPasteToDay}
          aria-label={`Paste ${count} copied foods to ${targetLabel}`}
          title={`Paste to ${targetLabel}`}
        >
          <ClipboardPaste size={16}/>
          <span>Paste to {targetLabel}</span>
        </Button>
        <Button
          variant="tertiary"
          size="icon"
          onClick={onClear}
          aria-label="Clear clipboard"
          title="Clear clipboard"
        >
          <X size={16}/>
        </Button>
      </div>
    </div>
  );
}
