import type {CSSProperties} from 'react';
import type {MacroSplit} from '../lib/macros';
import {adjustSplit,gramsFromSplit,macroKeys,macroLabels,macroLimits,macroPresetId,macroPresets} from '../lib/macros';
import {number} from '../lib/format';
import {Button} from './ui/Button';
import {CoachNumber} from './ui/CoachMotion';

/**
 * One slider and one input per macro, both bound to the same share of the calorie target.
 * Moving one macro moves the other two, so the three shares always describe the same target.
 */
export function MacroSetup({
  calories,
  split,
  onChange,
  onPreset
}:{
  calories:number;
  split:MacroSplit;
  onChange:(next:MacroSplit)=>void;
  onPreset:(id:string,next:MacroSplit|null)=>void;
}){
  const grams=gramsFromSplit(calories,split);
  const fill=(key:typeof macroKeys[number])=>Math.round(100*(split[key]-macroLimits[key].min)/(macroLimits[key].max-macroLimits[key].min));
  const active=macroPresetId(split);
  return <div className="macro-setup">
    <div className="macro-presets" role="group" aria-label="Macro presets">
      {macroPresets.map(preset=><Button
        key={preset.id}
        type="button"
        size="sm"
        variant={active===preset.id?'primary':'secondary'}
        aria-pressed={active===preset.id}
        onClick={()=>onPreset(preset.id,preset.split)}
      >{preset.label}</Button>)}
    </div>
    <div className="macro-rows">
      {macroKeys.map(key=><div className="macro-row" key={key}>
        <label className="macro-row-head" htmlFor={`macro-${key}`}>
          <span className={`macro-swatch ${key}`} aria-hidden="true"/>
          <span className="macro-row-label">{macroLabels[key]}</span>
          <strong className="macro-row-grams"><CoachNumber>{number(grams[key])}</CoachNumber> g</strong>
        </label>
        <div className="macro-row-controls">
          <input
            id={`macro-${key}`}
            type="range"
            className={`macro-range ${key}`}
            min={macroLimits[key].min}
            max={macroLimits[key].max}
            step="1"
            value={split[key]}
            style={{'--range-fill':`${fill(key)}%`} as CSSProperties}
            aria-label={`${macroLabels[key]} share of daily energy`}
            aria-valuetext={`${split[key]}% · ${grams[key]} g`}
            onChange={event=>onChange(adjustSplit(split,key,Number(event.target.value)))}
          />
          <div className="macro-number">
            <input
              type="number"
              inputMode="numeric"
              min={macroLimits[key].min}
              max={macroLimits[key].max}
              step="1"
              value={split[key]}
              aria-label={`${macroLabels[key]} percent`}
              onChange={event=>onChange(adjustSplit(split,key,Number(event.target.value)))}
            />
            <span aria-hidden="true">%</span>
          </div>
        </div>
      </div>)}
    </div>
  </div>;
}
