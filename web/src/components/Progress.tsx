import {useState} from 'react';
import {energyDays} from '../lib/energyBalance';
import type {Nourish} from '../useNourish';
import {number,today,trend} from '../lib/format';
import {Button} from './ui/Button';
import {Field,SelectField} from './ui/Field';
import {DatePicker} from './ui/DatePicker';
import {PhysiquePhotos} from './PhysiquePhotos';
import {WeightChart} from './WeightChart';
import {CoachingProgress} from './CoachingProgress';
import {EnergyBalance} from './EnergyBalance';

type Tab='weight'|'energy'|'photos';

export function Progress({store}:{store:Nourish}){
  const [tab,setTab]=useState<Tab>('weight');
  const [period,setPeriod]=useState('recent');
  const [date,setDate]=useState(today(store.state!.profile?.timeZone));
  const [kg,setKg]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const state=store.state!;
  const weights=state.weights.filter(w=>!w.deleted);
  const smoothed=trend([...(state.weightTrendSeed??[]),...weights]).filter(w=>w.date>=state.start&&w.date<=state.end);
  const latest=smoothed.at(-1);
  const mean=weights.length?weights.reduce((s,w)=>s+w.kg,0)/weights.length:null;
  const complete=energyDays({entries:state.entries,days:state.days,estimates:[],current:today(state.profile?.timeZone)},state.start,state.end).filter(d=>d.complete);
  const intake=complete.reduce((sum,d)=>sum+(d.intake??0),0);
  const tabs=[['weight','Weight'],['energy','Energy'],['photos','Photos']] as const;
  return <>
    <header className="page-heading">
      <div><h1>Progress</h1></div>
      <SelectField label="History window" value={period} onChange={v=>{
        setPeriod(v);
        void store.refresh(v).catch(ex=>setError(ex.message));
      }}>
        <option value="recent">Recent 90 days</option>
        {Array.from({length:new Date().getFullYear()-1999},(_,i)=>String(new Date().getFullYear()-i)).map(y=><option key={y} value={y}>{y}</option>)}
      </SelectField>
    </header>
    <div className="tabs" role="group" aria-label="Progress sections">
      {tabs.map(([id,label])=><Button key={id} variant={tab===id?'primary':'secondary'} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</Button>)}
    </div>
    {tab==='weight'&&<>
      <div className="stats-grid">
        <section className="panel">
          <p className="eyebrow">TREND WEIGHT</p>
          <h2>{number(latest?.kg,1)} <span className="unit">kg</span></h2>
          <p>{latest?latest.date:'No weigh-in yet'}</p>
        </section>
        <section className="panel">
          <p className="eyebrow">AVERAGE SCALE WEIGHT</p>
          <h2>{number(mean,1)} <span className="unit">kg</span></h2>
          <p>{weights.length} weigh-ins</p>
        </section>
        <section className="panel">
          <p className="eyebrow">COMPLETE-DAY INTAKE</p>
          <h2>{number(complete.length?intake/complete.length:null)} <span className="unit">kcal</span></h2>
          <p>{complete.length} complete days</p>
        </section>
      </div>
      <WeightChart weights={weights} smoothed={smoothed}/>
      <section className="panel log-weight-panel">
        <div className="section-heading"><div><h2>Log your weight</h2></div></div>
        <form onSubmit={async e=>{
          e.preventDefault();
          setBusy(true);
          try{
            const old=weights.find(w=>w.date===date)??state.weights.find(w=>w.date===date);
            await store.mutate({
              kind:'weight',
              recordId:old?.id??crypto.randomUUID(),
              expectedRevision:old?.revision??0,
              data:{date,kg:Number(kg)},
              delete:false
            });
            setKg('');
            setError('');
          }catch(ex){
            setError((ex as Error).message);
          }finally{
            setBusy(false);
          }
        }}>
          <div className="form-grid">
            <DatePicker label="Weigh-in date" value={date} max={today(state.profile?.timeZone)} required onChange={setDate}/>
            <Field label="Weight (kg)" type="number" min="20" max="400" step="0.01" required value={kg} onChange={e=>setKg(e.target.value)}/>
          </div>
          <Button type="submit" variant="primary" size="md" disabled={busy}>
            {busy?'Saving…':weights.some(w=>w.date===date)?'Update weigh-in':'Save weigh-in'}
          </Button>
        </form>
        {error&&<p role="alert" className="error">{error}</p>}
        <div className="weight-history">
          {weights.slice(-10).reverse().map(w=><div className="history-row" key={w.id}>
            <span>{w.date}</span>
            <strong>{number(w.kg,2)} kg</strong>
            <Button variant="tertiary" size="md" onClick={()=>{setDate(w.date);setKg(String(w.kg));}}>Edit</Button>
            <Button variant="tertiary" size="md" onClick={async()=>{
              try{
                await store.mutate({kind:'weight',recordId:w.id,expectedRevision:w.revision,data:w,delete:true});
              }catch(ex){
                setError((ex as Error).message);
              }
            }}>Delete</Button>
          </div>)}
        </div>
      </section>
    </>}
    {tab==='energy'&&<>
      <EnergyBalance store={store}/>
      <CoachingProgress store={store}/>
    </>}
    {tab==='photos'&&<PhysiquePhotos store={store}/>}
  </>;
}
