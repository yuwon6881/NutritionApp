import {Field} from './ui/Field';
import type {CSSProperties} from 'react';
import type {MacroSplit} from '../lib/macros';
import {adjustSplit,gramsFromSplit,macroKeys,macroLabels,macroLimits,macroPresetId,macroPresets} from '../lib/macros';
import {number} from '../lib/format';
import {SegmentedControl} from './ui/SegmentedControl';
import {CoachNumber} from './ui/CoachMotion';

/**
 * Dragging sliders moves energy between macronutrients.
 * Presets re-align the shares in one touch.
 */
export function MacroSetup({
  calories,
  split,
  onChange,
  onPreset,
}:{
  calories:number;
  split:MacroSplit;
  onChange:(split:MacroSplit)=>void;
  onPreset:(id:string,split:MacroSplit|null)=>void;
}){
  const grams=gramsFromSplit(calories,split);
  const fill=(key:typeof macroKeys[number])=>Math.round(100*(split[key]-macroLimits[key].min)/(macroLimits[key].max-macroLimits[key].min));
  const active=macroPresetId(split);
  return <div className="macro-setup">
    <SegmentedControl className="macro-presets" label="Macro presets" value={active} size="sm" layout="wrap"
      options={macroPresets.map(preset=>({value:preset.id,label:preset.label}))}
      onChange={id=>{const preset=macroPresets.find(p=>p.id===id);if(preset)onPreset(preset.id,preset.split);}}/>
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
            name={`macro-${key}-share`}
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
            <Field
              id={`macro-${key}-percent`}
              name={`macro-${key}-percent`}
              label={`${macroLabels[key]} percent`}
              required
              type="number"
              inputMode="numeric"
              min={macroLimits[key].min}
              max={macroLimits[key].max}
              step="1"
              value={split[key]}
              aria-label={`${macroLabels[key]} percent`}
              onChange={event=>{const value=Number(event.target.value);if(event.target.value&&event.target.validity.valid)onChange(adjustSplit(split,key,value));}}
            />
            <span aria-hidden="true">%</span>
          </div>
        </div>
      </div>)}
    </div>
  </div>;
}
