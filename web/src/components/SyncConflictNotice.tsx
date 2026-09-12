import {AlertTriangle} from 'lucide-react';
import type {CoachingSettings,Mutation} from '../types';
import type {Nourish} from '../useNourish';
import {Button} from './ui/Button';

const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const statuses:Record<string,string>={complete:'Complete',fasting:'Fasting',incomplete:'Still logging',not_logged:'Not logging'};

function dataOf(operation:Mutation){
  return operation.data&&typeof operation.data==='object'?operation.data as Record<string,unknown>:{};
}

function titleOf(operation:Mutation){
  const data=dataOf(operation);
  if(operation.kind==='day')return `Daily logging decision${typeof data.date==='string'?` · ${data.date}`:''}`;
  if(operation.kind==='settings')return 'Coaching preferences';
  if(operation.kind==='profile')return 'Coach profile';
  if(operation.kind==='weight')return `Weigh-in${typeof data.date==='string'?` · ${data.date}`:''}`;
  if(operation.kind==='food')return `Saved food${typeof data.name==='string'&&data.name?` · ${data.name}`:''}`;
  return `Food entry${typeof data.name==='string'&&data.name?` · ${data.name}`:''}`;
}

function summaryOf(operation:Mutation){
  if(operation.kind==='day'){
    const data=dataOf(operation);
    const status=typeof data.status==='string'?statuses[data.status]??data.status:'this decision';
    return `This device queued “${status}”, but the saved day could not accept this change.`;
  }
  if(operation.kind==='settings')return 'Your check-in or display preferences could not accept this queued update.';
  if(operation.kind==='profile')return 'The saved coaching profile could not accept this queued update.';
  return 'The saved record could not accept this queued edit.';
}

function detailsOf(operation:Mutation){
  const data=dataOf(operation);
  if(operation.kind==='day')return <dl className="sync-conflict-details"><div><dt>Date</dt><dd>{typeof data.date==='string'?data.date:'Unknown'}</dd></div><div><dt>Queued choice</dt><dd>{typeof data.status==='string'?statuses[data.status]??data.status:'Unknown'}</dd></div></dl>;
  if(operation.kind==='settings'){
    const settings=data as Partial<CoachingSettings>;
    return <dl className="sync-conflict-details">
      {typeof settings.checkInWeekday==='number'&&<div><dt>Check-in day</dt><dd>{weekdays[settings.checkInWeekday]??'Unknown'}</dd></div>}
      {settings.weightUnit!==undefined&&<div><dt>Weight display</dt><dd>{settings.weightUnit==='lb'?'Pounds (lb)':'Kilograms (kg)'}</dd></div>}
      {settings.energyUnit!==undefined&&<div><dt>Energy display</dt><dd>{settings.energyUnit==='kj'?'Kilojoules (kJ)':'Kilocalories (kcal)'}</dd></div>}
      {settings.heightUnit!==undefined&&<div><dt>Height display</dt><dd>{settings.heightUnit==='ft-in'?'Feet / inches':'Centimetres (cm)'}</dd></div>}
      {settings.missingDayAction!==undefined&&<div><dt>Unlogged days</dt><dd>{settings.missingDayAction==='fasting'?'Default to fasting':settings.missingDayAction==='not_logged'?'Default to not logging':'Ask each time'}</dd></div>}
    </dl>;
  }
  const values=[
    typeof data.date==='string'?['Date',data.date]:null,
    typeof data.kg==='number'?['Weight',`${data.kg} kg`]:null,
    typeof data.calories==='number'?['Energy',`${data.calories} kcal`]:null
  ].filter((value):value is [string,string]=>value!==null);
  return values.length?<dl className="sync-conflict-details">{values.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>:null;
}

function ConflictItem({operation,discard}:{operation:Mutation;discard:(id:string)=>void}){
  return <article className="sync-conflict-item">
    <div className="sync-conflict-item-heading"><div><h3>{titleOf(operation)}</h3><p>{summaryOf(operation)}</p></div><span>Needs review</span></div>
    {detailsOf(operation)}
    {operation.error&&<p className="source sync-conflict-error">{operation.error}</p>}
    <details className="sync-conflict-technical"><summary>Show technical details</summary><pre>{JSON.stringify(operation.data,null,2)}</pre></details>
    <p className="source">The saved server record remains protected. Discard this local edit to continue with the saved value.</p>
    <Button variant="destructive" onClick={()=>discard(operation.id)}>Discard local edit</Button>
  </article>;
}

export function SyncConflictNotice({store}:{store:Nourish}){
  const conflicts=store.local?.queue.filter(operation=>operation.error)??[];
  if(!conflicts.length)return null;
  return <section className="sync-conflict-notice" role="alert" aria-labelledby="sync-conflict-title">
    <div className="sync-conflict-heading">
      <span className="sync-conflict-icon" aria-hidden="true"><AlertTriangle size={19}/></span>
      <div><p className="eyebrow">Action needed</p><h2 id="sync-conflict-title">A saved edit needs review</h2><p>The saved record could not accept a local edit. Review the queued value, then discard it to continue with the saved value.</p></div>
      <span className="sync-conflict-count">{conflicts.length} {conflicts.length===1?'edit':'edits'}</span>
    </div>
    <div className="sync-conflict-list">{conflicts.map(operation=><ConflictItem key={operation.id} operation={operation} discard={id=>void store.discardConflict(id)}/>)}</div>
  </section>;
}
