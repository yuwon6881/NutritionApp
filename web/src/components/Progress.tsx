import {useState} from 'react';
import type {Nourish} from '../useNourish';
import {number,today,trend} from '../lib/format';
import {Button} from './ui/Button';
import {Field,SelectField} from './ui/Field';
import {PhysiquePhotos} from './PhysiquePhotos';
import {WeightChart} from './WeightChart';
import {CoachingProgress} from './CoachingProgress';
import {EnergyBalance} from './EnergyBalance';

export function Progress({store}:{store:Nourish}){
  const [period,setPeriod]=useState('recent');
  const [date,setDate]=useState(today(store.state!.profile?.timeZone));
  const [kg,setKg]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);

  const weights=store.state!.weights.filter(w=>!w.deleted);
  const smoothed=trend([...(store.state!.weightTrendSeed??[]),...weights]).filter(w=>w.date>=store.state!.start&&w.date<=store.state!.end);
  const latest=smoothed.at(-1);
  const mean=weights.length?weights.reduce((s,w)=>s+w.kg,0)/weights.length:null;
  const complete=store.state!.days.filter(d=>!d.deleted&&d.status!=='incomplete');
  const dates=new Set(complete.map(d=>d.date));
  const intake=store.state!.entries.filter(e=>!e.deleted&&dates.has(e.date)).reduce((s,e)=>s+e.calories,0)+complete.filter(d=>d.archived).reduce((s,d)=>s+(d.calories??0),0);

  return <>
    <header className="page-heading">
      <div>
        <p className="eyebrow">LOOK AT THE BIGGER PICTURE</p>
        <h1>Progress, with perspective</h1>
        <p>Daily weight moves around. Your trend helps you see beyond it.</p>
      </div>
      <SelectField label="History window" value={period} onChange={v=>{
        setPeriod(v);
        void store.refresh(v).catch(ex=>setError(ex.message));
      }}>
        <option value="recent">Recent 90 days</option>
        {Array.from({length:new Date().getFullYear()-1999},(_,i)=>String(new Date().getFullYear()-i)).map(y=><option key={y} value={y}>{y}</option>)}
      </SelectField>
    </header>

    <div className="stats-grid">
      <section className="panel">
        <p className="eyebrow">TREND WEIGHT</p>
        <h2>{number(latest?.kg,1)} <span className="unit">kg</span></h2>
        <p>{latest?`As of ${latest.date}`:'Add a weigh-in to begin.'}</p>
      </section>
      <section className="panel">
        <p className="eyebrow">AVERAGE SCALE WEIGHT</p>
        <h2>{number(mean,1)} <span className="unit">kg</span></h2>
        <p>{weights.length} recorded weigh-ins in this window</p>
      </section>
      <section className="panel">
        <p className="eyebrow">COMPLETE-DAY INTAKE</p>
        <h2>{number(complete.length?intake/complete.length:null)} <span className="unit">kcal</span></h2>
        <p>{complete.length} complete or fasting days · partial days excluded</p>
      </section>
    </div>

    <section className="panel log-weight-panel">
      <div className="section-heading">
        <div>
          <h2>Log your weight</h2>
          <p>Weigh in regularly to help your coach calibrate expenditure.</p>
        </div>
      </div>
      <form onSubmit={async e=>{
        e.preventDefault();
        setBusy(true);
        try{
          const old=weights.find(w=>w.date===date)??store.state!.weights.find(w=>w.date===date);
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
          <Field label="Weigh-in date" type="date" value={date} max={today(store.state!.profile?.timeZone)} required onChange={e=>setDate(e.target.value)}/>
          <Field label="Weight (kg)" type="number" min="20" max="400" step="0.01" required value={kg} onChange={e=>setKg(e.target.value)}/>
        </div>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy?'Saving…':weights.some(w=>w.date===date)?'Update weigh-in':'Save weigh-in'}
        </Button>
      </form>
      {error&&<p role="alert" className="error">{error}</p>}
      <div className="weight-history">
        {weights.slice(-10).reverse().map(w=><div className="history-row" key={w.id}>
          <span>{w.date}</span>
          <strong>{number(w.kg,2)} kg</strong>
          <Button variant="tertiary" onClick={()=>{setDate(w.date);setKg(String(w.kg));}}>Edit</Button>
          <Button variant="tertiary" onClick={async()=>{
            try{
              await store.mutate({kind:'weight',recordId:w.id,expectedRevision:w.revision,data:w,delete:true});
            }catch(ex){
              setError((ex as Error).message);
            }
          }}>Delete</Button>
        </div>)}
      </div>
    </section>

    <WeightChart weights={weights} smoothed={smoothed}/>
    <CoachingProgress store={store}/>
    <EnergyBalance store={store}/>
    <PhysiquePhotos store={store}/>
  </>;
}
