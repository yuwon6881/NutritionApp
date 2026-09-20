import {useState} from 'react';
import {Field} from './ui/Field';
import type {MacroKey,MacroSplit} from '../lib/macros';
import {adjustSplit,gramsFromSplit,macroEnergy,macroKeys,macroLabels,macroLimits,macroPresetId,macroPresets} from '../lib/macros';
import {SegmentedControl} from './ui/SegmentedControl';
import {Button} from './ui/Button';
import {Slider} from './ui/Slider';

const presetDescriptions:Record<string,string>={
  auto:'Calculated optimal protein intake based on your body weight and training, with balanced carbs and fats.',
  balanced:'Equal emphasis on macronutrients for dietary flexibility and varied whole foods.',
  'high-protein':'Elevated protein to maximize muscle preservation, satiety, and recovery.',
  'lower-carb':'Reduced carbohydrate intake with higher healthy fats and satisfying protein.',
  keto:'Very low carbohydrate ketogenic protocol focused on healthy dietary fats.',
  mediterranean:'Heart-healthy fat profile paired with unrefined carbohydrates and moderate protein.',
  'high-carb':'Carbohydrate-focused fueling suited for high-volume endurance and athletic performance.',
  custom:'Custom macronutrient distribution fine-tuned to your preferences.'
};

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
  coachDefault,
  customSplit,
}:{
  calories:number;
  split:MacroSplit;
  onChange:(split:MacroSplit)=>void;
  onPreset:(id:string,split:MacroSplit|null)=>void;
  mode?:'all'|'presets'|'adjustments';
  presetId?:string;
  coachDefault?:MacroSplit;
  customSplit?:MacroSplit;
}){
  const [gramDrafts,setGramDrafts]=useState<Partial<Record<MacroKey,string>>>({});
  const grams=gramsFromSplit(calories,split);
  const minGrams=(key:MacroKey)=>calories>0?Math.round(calories*macroLimits[key].min/100/macroEnergy[key]):0;
  const maxGrams=(key:MacroKey)=>calories>0?Math.round(calories*macroLimits[key].max/100/macroEnergy[key]):1000;
  const active=presetId??macroPresetId(split);
  const presetOptions=macroPresets.map(preset=>({
    ...preset,
    split:preset.id==='auto'?(coachDefault??split):preset.split
  })).concat([{id:'custom',label:'Custom',split:customSplit??split}]);
  return <div className="macro-setup">
    {mode==='presets'?(
      <div className="macro-preset-grid macro-presets" role="group" aria-label="Macro presets">
        {presetOptions.map(preset=>{
          const isSelected=active===preset.id;
          const targetSplit=preset.split??split;
          const targetGrams=gramsFromSplit(calories,targetSplit);
          return (
            <Button
              key={preset.id}
              presentation="plain"
              className={`macro-preset-card ${isSelected?'selected':''}`}
              aria-label={preset.label}
              onClick={()=>onPreset(preset.id,preset.id==='auto'?null:preset.split)}
              aria-pressed={isSelected}
              aria-checked={isSelected}
            >
              <div className="macro-preset-card-header">
                <div className="macro-preset-title-row">
                  <span className="macro-preset-name">{preset.label}</span>
                  {preset.id==='auto'&&<span className="macro-preset-badge">Recommended</span>}
                </div>
                <div className="macro-preset-radio" aria-hidden="true">
                  {isSelected&&<div className="macro-preset-radio-inner"/>}
                </div>
              </div>
              <p className="macro-preset-desc">{presetDescriptions[preset.id]??''}</p>
              <div className="macro-preset-bar" aria-hidden="true">
                <div className="macro-bar-segment protein" style={{width:`${targetSplit.protein}%`}}/>
                <div className="macro-bar-segment carbs" style={{width:`${targetSplit.carbs}%`}}/>
                <div className="macro-bar-segment fat" style={{width:`${targetSplit.fat}%`}}/>
              </div>
              <div className="macro-preset-stats">
                <span className="macro-stat protein">
                  <span className="macro-swatch protein" aria-hidden="true"/>
                  <span>Protein</span> <strong>{targetSplit.protein}%</strong> <small>{targetGrams.protein}g</small>
                </span>
                <span className="macro-stat carbs">
                  <span className="macro-swatch carbs" aria-hidden="true"/>
                  <span>Carbs</span> <strong>{targetSplit.carbs}%</strong> <small>{targetGrams.carbs}g</small>
                </span>
                <span className="macro-stat fat">
                  <span className="macro-swatch fat" aria-hidden="true"/>
                  <span>Fat</span> <strong>{targetSplit.fat}%</strong> <small>{targetGrams.fat}g</small>
                </span>
              </div>
            </Button>
          );
        })}
      </div>
    ):mode!=='adjustments'?(
      <SegmentedControl className="macro-presets" label="Macro presets" value={active} size="sm" layout="wrap"
        options={presetOptions.map(preset=>({value:preset.id,label:preset.label}))}
        onChange={id=>{const preset=presetOptions.find(item=>item.id===id);if(preset)onPreset(preset.id,preset.id==='auto'?null:preset.split);}}/>
    ):null}
    {mode!=='presets'&&<div className="macro-rows">
      {macroKeys.map(key=><div className="macro-row" key={key}>
        <label className="macro-row-head" htmlFor={`macro-${key}`}>
          <span className={`macro-swatch ${key}`} aria-hidden="true"/>
          <span className="macro-row-label">{macroLabels[key]}</span>
          <strong className="macro-row-percent">{split[key]}%</strong>
        </label>
        <div className="macro-row-controls">
          <Slider
            id={`macro-${key}`}
            name={`macro-${key}-share`}
            label={macroLabels[key]}
            showLabel={false}
            className={`macro-slider ${key}`}
            min={macroLimits[key].min}
            max={macroLimits[key].max}
            step={1}
            value={split[key]}
            formatValue={value=>`${value}% · ${grams[key]} g`}
            ariaLabel={`${macroLabels[key]} share of daily energy`}
            onChange={value=>onChange(adjustSplit(split,key,value))}
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
              value={gramDrafts[key]??grams[key]}
              aria-label={`${macroLabels[key]} grams`}
              onChange={event=>{
                const value=event.target.value;
                if(!value||!event.target.validity.valid||calories<=0){
                  setGramDrafts(current=>({...current,[key]:value}));
                  return;
                }
                const targetPercent=(Number(value)*macroEnergy[key]/calories)*100;
                setGramDrafts(current=>{
                  const next={...current};
                  delete next[key];
                  return next;
                });
                onChange(adjustSplit(split,key,targetPercent));
              }}
              onBlur={event=>{
                const value=Number(event.target.value);
                if(event.target.value&&!isNaN(value)&&calories>0){
                  const clamped=Math.min(Math.max(value,minGrams(key)),maxGrams(key));
                  const targetPercent=(clamped*macroEnergy[key]/calories)*100;
                  setGramDrafts(current=>{
                    const next={...current};
                    delete next[key];
                    return next;
                  });
                  onChange(adjustSplit(split,key,targetPercent));
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
