import {describe,expect,it} from 'vitest';
import {macroStanding,macroStandingCaption,macroStandingLabel} from './macroStanding';

describe('macroStanding',()=>{
  it('reports grams left and the eaten share of the ring',()=>{
    expect(macroStanding(52,130)).toEqual({kind:'left',grams:78,fill:0.4,overflow:0});
    expect(macroStanding(0,130)).toEqual({kind:'left',grams:130,fill:0,overflow:0});
  });

  it('fills the ring past the target and laps the overflow, capped at one more lap',()=>{
    expect(macroStanding(150,100)).toEqual({kind:'over',grams:50,fill:1,overflow:0.5});
    expect(macroStanding(400,100).overflow).toBe(1);
  });

  it('treats a difference that rounds away as on target',()=>{
    expect(macroStanding(129.6,130)).toEqual({kind:'on',grams:null,fill:1,overflow:0});
  });

  it('keeps unknown intake unknown and never reads a missing target as zero',()=>{
    expect(macroStanding(null,130)).toEqual({kind:'unknown',grams:null,fill:0,overflow:0});
    expect(macroStanding(undefined,undefined).kind).toBe('unknown');
    expect(macroStanding(40,null)).toEqual({kind:'logged',grams:40,fill:0,overflow:0});
    expect(macroStanding(40,0).kind).toBe('logged');
  });

  it('captions and labels each standing in plain words',()=>{
    expect(macroStandingCaption(macroStanding(52,130))).toBe('g left');
    expect(macroStandingCaption(macroStanding(150,100))).toBe('g over');
    expect(macroStandingCaption(macroStanding(130,130))).toBe('On target');
    expect(macroStandingCaption(macroStanding(40,null))).toBe('g eaten');
    expect(macroStandingCaption(macroStanding(null,130))).toBe('Not reported');
    expect(macroStandingLabel('Protein',52,130)).toBe('Protein: 52 g eaten of 130 g, 78 g left');
    expect(macroStandingLabel('Fat',150,100)).toBe('Fat: 150 g eaten of 100 g, 50 g over');
    expect(macroStandingLabel('Carbs',40,null)).toBe('Carbs: 40 g eaten, no target');
    expect(macroStandingLabel('Carbs',null,200)).toBe('Carbs: no logged food reports it');
  });
});
