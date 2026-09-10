import {useState} from 'react';
import {energyDays} from '../lib/energyBalance';
import type {Nourish} from '../useNourish';
import type {Weight} from '../types';
import {today,trend} from '../lib/format';
import {Button} from './ui/Button';
import {SelectField} from './ui/Field';
import {PhysiquePhotos} from './PhysiquePhotos';
import {WeightChart} from './WeightChart';
import {CoachingProgress} from './CoachingProgress';
import {EnergyBalance} from './EnergyBalance';
import {useHistoryWindow} from '../useHistoryWindow';
import {WeightEntryDialog} from './WeightEntryDialog';
import {SegmentedControl} from './ui/SegmentedControl';
import {MotionPanel} from './ui/Motion';
import {displayEnergy,displayWeight,energyLabel,unitsFor,weightLabel} from '../lib/units';

type Tab='weight'|'energy'|'photos';

export function Progress({store}:{store:Nourish}){
  const [tab,setTab]=useState<Tab>('weight');
  const [period,setPeriod]=useState('recent');
  const [weightOpen,setWeightOpen]=useState(false);
  const [weightEdit,setWeightEdit]=useState<Weight>();
  const [weightReturnFocus,setWeightReturnFocus]=useState<HTMLElement|null>(null);
  const history=useHistoryWindow(store,period,tab==='weight');
  const state=history.state??store.state!;
  const units=unitsFor(state.settings);
  const weights=state.weights.filter(weight=>!weight.deleted);
  const smoothed=trend([...(state.weightTrendSeed??[]),...weights]).filter(weight=>weight.date>=state.start&&weight.date<=state.end);
  const latest=smoothed.at(-1);
  const mean=weights.length?weights.reduce((sum,weight)=>sum+weight.kg,0)/weights.length:null;
  const complete=energyDays({entries:state.entries,days:state.days,estimates:[],current:today(state.profile?.timeZone)},state.start,state.end).filter(day=>day.complete);
  const intake=complete.reduce((sum,day)=>sum+(day.intake??0),0);
  const tabs=[['weight','Weight'],['energy','Energy'],['photos','Photos']] as const;
  const tabDirection:1|-1=tab==='photos'?-1:1;
  const addWeight=(trigger?:HTMLElement|null)=>{setWeightEdit(undefined);setWeightReturnFocus(trigger??null);setWeightOpen(true);};

  return <>
    <header className="page-heading"><div><h1 data-page-heading tabIndex={-1}>Progress</h1></div>{tab==='weight'&&<Button variant="primary" onClick={event=>addWeight(event.currentTarget)}>Add weigh-in</Button>}</header>
    <SegmentedControl<Tab> id="progress-tabs" className="section-segments" label="Progress sections" value={tab} onChange={setTab} options={tabs.map(([value,label])=>({value,label}))}/>
    <MotionPanel motionKey={tab} direction={tabDirection}>
    <div role="tabpanel" aria-label={`${tabs.find(([value])=>value===tab)?.[1]??tab} progress`}>
    {tab==='weight'&&<>
      <div className="history-filter"><SelectField label="Weight history period" value={period} onChange={setPeriod}>
        <option value="recent">Recent 90 days</option>
        {Array.from({length:Number(today(state.profile?.timeZone).slice(0,4))-1999},(_,index)=>String(Number(today(state.profile?.timeZone).slice(0,4))-index)).map(year=><option key={year} value={year}>{year}</option>)}
      </SelectField></div>
      {history.error&&<p className="notice" role="status">{history.state?'Saved history shown.':'This history is not available on this device.'} {history.error} <Button onClick={history.retry}>Retry history</Button></p>}
      {!history.state&&!history.error&&<p role="status">Loading weight history…</p>}
      {history.state&&<>
        <div className="stats-grid">
          <section className="panel"><p className="eyebrow">TREND WEIGHT</p><h2>{displayWeight(latest?.kg,units.weight,1)} <span className="unit">{weightLabel(units.weight)}</span></h2><p>{latest?latest.date:'No weigh-in yet'}</p></section>
          <section className="panel"><p className="eyebrow">AVERAGE SCALE WEIGHT</p><h2>{displayWeight(mean,units.weight,1)} <span className="unit">{weightLabel(units.weight)}</span></h2><p>{weights.length} weigh-ins</p></section>
          <section className="panel"><p className="eyebrow">COMPLETE-DAY INTAKE</p><h2>{displayEnergy(complete.length?intake/complete.length:null,units.energy)} <span className="unit">{energyLabel(units.energy)}</span></h2><p>{complete.length} complete days</p></section>
        </div>
        <WeightChart weights={weights} smoothed={smoothed} weightUnit={units.weight}/>
        <section className="panel weight-history-panel">
          <div className="section-heading"><div><h2>Weight history</h2><p>Choose a weigh-in to edit it in the same dialog.</p></div></div>
          <div className="weight-history">{weights.slice(-10).reverse().map(weight=><div className="history-row" key={weight.id}><span>{weight.date}</span><strong>{displayWeight(weight.kg,units.weight,2)} {weightLabel(units.weight)}</strong><Button variant="tertiary" size="md" onClick={event=>{setWeightEdit(weight);setWeightReturnFocus(event.currentTarget);setWeightOpen(true);}}>Edit</Button><Button variant="tertiary" size="md" onClick={()=>void store.mutate({kind:'weight',recordId:weight.id,expectedRevision:weight.revision,data:weight,delete:true})}>Delete</Button></div>)}</div>
        </section>
      </>}
    </>}
    {tab==='energy'&&<><EnergyBalance store={store}/><CoachingProgress store={store}/></>}
    {tab==='photos'&&<PhysiquePhotos store={store}/>
    }
    </div>
    </MotionPanel>
    <WeightEntryDialog open={weightOpen} store={store} date={today(store.state!.profile?.timeZone)} initial={weightEdit} restoreFocus={weightReturnFocus} onClose={()=>setWeightOpen(false)}/>
  </>;
}
