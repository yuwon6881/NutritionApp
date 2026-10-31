import {describe,expect,it} from 'vitest';
import type {GoalProgress} from '../types';
import {energyGap,paceSentence,planHeadline,proteinPerKg} from './coachTargetSummary';

describe('energyGap', () => {
  it('reports a deficit below maintenance', () => {
    expect(energyGap(1875, 2240)).toEqual({kcal: 365, direction: 'below'});
  });

  it('reports a surplus above maintenance', () => {
    expect(energyGap(2700, 2500)).toEqual({kcal: 200, direction: 'above'});
  });

  it('reports no gap when the figures round to the same value', () => {
    expect(energyGap(2200.2, 2200)).toEqual({kcal: 0, direction: 'at'});
  });

  it('stays unknown when either figure is missing', () => {
    expect(energyGap(1875, null)).toBeNull();
    expect(energyGap(null, 2240)).toBeNull();
    expect(energyGap(undefined, undefined)).toBeNull();
  });
});

describe('proteinPerKg', () => {
  it('divides protein by body weight to one decimal', () => {
    expect(proteinPerKg(132, 66.3)).toBe(2);
    expect(proteinPerKg(120, 80)).toBe(1.5);
  });

  it('stays unknown without a usable protein target or weight', () => {
    expect(proteinPerKg(null, 66.3)).toBeNull();
    expect(proteinPerKg(132, null)).toBeNull();
    expect(proteinPerKg(132, 0)).toBeNull();
  });
});

describe('paceSentence', () => {
  it('spells out the weekly rate with its mass equivalent', () => {
    expect(paceSentence(-0.5, 66.3, 'kg')).toBe('0.5% of body weight per week (about 0.3 kg)');
  });

  it('uses the chosen weight unit', () => {
    expect(paceSentence(0.25, 80, 'lb')).toBe('0.25% of body weight per week (about 0.4 lb)');
  });

  it('omits the mass when the weight is unknown', () => {
    expect(paceSentence(-0.5, null, 'kg')).toBe('0.5% of body weight per week');
  });
});

describe('planHeadline', () => {
  const weightGoal:GoalProgress={mode:'weight',goal:'lose',percent:6,complete:false,estimatedFinish:'2027-01-19',phaseEnd:null,trendWeight:66.3,startWeight:66.3,targetWeight:62.5,remaining:3.8,weeklyChange:null,explanation:''};
  const units={weight:'kg' as const,energy:'kcal' as const,height:'cm' as const};

  it('states the amount left and the estimated finish for a weight goal', () => {
    const text=planHeadline(weightGoal,'lose',units);
    expect(text).toMatch(/^Lose 3\.8 kg by /);
    expect(text).toContain('2027');
  });

  it('leaves the finish out when it cannot be estimated', () => {
    expect(planHeadline({...weightGoal,estimatedFinish:null,optimisticFinish:null},'lose',units)).toBe('Lose 3.8 kg');
  });

  it('uses the weight unit chosen in settings', () => {
    expect(planHeadline({...weightGoal,goal:'gain',estimatedFinish:null,remaining:2},'gain',{...units,weight:'lb'})).toBe('Gain 4.4 lb');
  });

  it('announces a reached goal', () => {
    expect(planHeadline({...weightGoal,complete:true,remaining:0},'lose',units)).toBe('Goal reached');
  });

  it('names a timed phase by its end date',() => {
    const text=planHeadline({mode:'duration',percent:20,complete:false,estimatedFinish:null,phaseEnd:'2026-12-20',trendWeight:null,weeklyChange:null,explanation:''},'lose',units);
    expect(text).toMatch(/^Fat loss until /);
  });

  it('falls back to the goal name without progress',() => {
    expect(planHeadline(null,'maintain',units)).toBe('Maintenance');
    expect(planHeadline(null,'',units)).toBe('Maintenance');
  });
});
