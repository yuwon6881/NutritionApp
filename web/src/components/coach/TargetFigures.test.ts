import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {TargetFigures} from './TargetFigures';
import type {CoachResult,UnitPreferences} from '../../types';

const units:UnitPreferences={energy:'kcal',weight:'kg',height:'cm'};
const result:CoachResult={
  eligible:true,adaptive:true,version:'1.0',calories:1875,expenditure:2240,protein:132,carbs:196,fat:63,
  explanation:'',weeklyCalories:13125,dailyCalories:[1875,1875,1875,1875,1875,1875,1875]
};
const render=(value:CoachResult,weightKg?:number|null)=>renderToStaticMarkup(createElement(TargetFigures,{result:value,units,weightKg}));

describe('TargetFigures',()=>{
  it('states the gap to maintenance in words',()=>{
    const html=render(result,66.3);
    expect(html).toContain('365 kcal below maintenance');
    expect(html).toContain('Maintenance 2,240 kcal');
  });

  it('shows protein per kilogram only when body weight is known',()=>{
    expect(render(result,66.3)).toContain('2 g/kg');
    expect(render(result,null)).not.toContain('g/kg');
  });

  it('leaves the gap out when maintenance is unknown instead of showing zero',()=>{
    const html=render({...result,expenditure:null},66.3);
    expect(html).not.toContain('maintenance');
    expect(html).not.toContain('target-energy-gap');
  });

  it('keeps one grams figure per macro row',()=>{
    const html=render(result,66.3);
    expect(html.match(/<strong>/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('132 <span class="unit">g</span>');
    expect(html).toContain('of energy');
  });
});
