import {Field} from './ui/Field';
import type {CSSProperties} from 'react';
import type {MacroKey,MacroSplit} from '../lib/macros';
import {adjustSplit,gramsFromSplit,macroEnergy,macroKeys,macroLabels,macroLimits,macroPresetId,macroPresets} from '../lib/macros';
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
  mode='all',
  presetId,
}:{
  calories:number;
  split:MacroSplit;
  onChange:(split:MacroSplit)=>void;
  onPreset:(id:string,split:MacroSplit|null)=>void;
  mode?:'all'|'presets'|'adjustments';
  presetId?:string;
}){
  const grams=gramsFromSplit(calories,split);
  const fill=(key:typeof macroKeys[number])=>Math.round(100*(split[key]-macroLimits[key].min)/(macroLimits[key].max-macroLimits[key].min));
  const minGrams=(key:MacroKey)=>calories>0?Math.round(calories*macroLimits[key].min/100/macroEnergy[key]):0;
  const maxGrams=(key:MacroKey)=>calories>0?Math.round(calories*macroLimits[key].max/100/macroEnergy[key]):1000;
  const active=presetId??macroPresetId(split);
  const presetOptions=active==='custom'&& !macroPresets.some(preset=>preset.id==='custom')
    ?[...macroPresets,{id:'custom',label:'Custom',split}]
    :macroPresets;
  return <div className="macro-setup">
    {mode!=='adjustments'&&<SegmentedControl className="macro-presets" label="Macro presets" value={active} size="sm" layout="wrap"
      options={presetOptions.map(preset=>({value:preset.id,label:preset.label}))}
      onChange={id=>{const preset=presetOptions.find(item=>item.id===id);if(preset)onPreset(preset.id,preset.split);}}/>}
    {mode!=='presets'&&<div className="macro-rows">
      {macroKeys.map(key=><div className="macro-row" key={key}>
        <label className="macro-row-head" htmlFor={`macro-${key}`}>
          <span className={`macro-swatch ${key}`} aria-hidden="true"/>
          <span className="macro-row-label">{macroLabels[key]}</span>
          <strong className="macro-row-percent"><CoachNumber>{split[key]}</CoachNumber>%</strong>
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
              id={`macro-${key}-grams`}
              name={`macro-${key}-grams`}
              label={`${macroLabels[key]} grams`}
              required
              type="number"
              inputMode="numeric"
              min={minGrams(key)}
              max={maxGrams(key)}
              step="1"
              value={grams[key]}
              aria-label={`${macroLabels[key]} grams`}
              onChange={event=>{
                const value=Number(event.target.value);
                if(event.target.value&&event.target.validity.valid&&calories>0){
                  const targetPercent=(value*macroEnergy[key]/calories)*100;
                  onChange(adjustSplit(split,key,targetPercent));
                }
              }}
              onBlur={event=>{
                const value=Number(event.target.value);
                if(event.target.value&&!isNaN(value)&&calories>0){
                  const clamped=Math.min(Math.max(value,minGrams(key)),maxGrams(key));
                  const targetPercent=(clamped*macroEnergy[key]/calories)*100;
                  onChange(adjustSplit(split,key,targetPercent));
                }else{
                  onChange({...split});
                }
              }}
            />
            <span aria-hidden="true">g</span>
          </div>
        </div>
      </div>)}
    </div>}
  </div>;
}
