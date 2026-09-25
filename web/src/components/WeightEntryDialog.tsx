import {Form} from './ui/Form';
import {useEffect,useState,type FormEvent} from 'react';
import type {Nourish} from '../useNourish';
import type {Weight} from '../types';
import {today} from '../lib/format';
import {Button} from './ui/Button';
import {Field} from './ui/Field';
import {Select} from './ui/Select';
import {DatePicker} from './ui/DatePicker';
import {Modal} from './ui/Modal';
import {parseWeight,unitsFor,weightLabel} from '../lib/units';
import {weightEntryDirty,weightEntryValues} from '../lib/weightEntry';
import {unusualWeightDifference,weightContextOptions} from '../lib/weightContext';
import {useAsyncAction} from './ui/useAsyncAction';

export interface WeightEntryDialogProps {
  open:boolean;
  store:Nourish;
  date?:string;
  initial?:Weight;
  onClose:()=>void;
  restoreFocus?:HTMLElement|null;
}

export function WeightEntryDialog({open,store,date,onClose,initial,restoreFocus}:WeightEntryDialogProps){
  const state=store.state!;
  const current=today(state.profile?.timeZone);
  const units=unitsFor(state.settings);
  // Fields and baseline are one state pair seeded from the same values. A baseline kept in a ref
  // and filled by the effect was still empty during the first render, and an effect that changed
  // no field never re-rendered to correct it, so an untouched form asked to discard on its first
  // close and only settled once that discard forced a render.
  const [values,setValues]=useState(()=>weightEntryValues(date,current,state.weights,initial,units.weight));
  const [baseline,setBaseline]=useState(values);
  const {busy,run}=useAsyncAction();
  const [error,setError]=useState('');

  useEffect(()=>{
    if(!open)return;
    const opened=weightEntryValues(date,current,state.weights,initial,units.weight);
    setValues(opened);setBaseline(opened);setError('');
  },[open,initial?.id,date]);

  const existing=state.weights.find(weight=>!weight.deleted&&weight.date===values.date);
  const unusual=unusualWeightDifference(values.kg,units.weight,values.date,state.weights,initial?.id);
  const dirty=weightEntryDirty(values,baseline);
  const save=async(event:FormEvent)=>{
    event.preventDefault();if(busy)return;
    setError('');
    try{
      // Editing a weigh-in and changing its date moves that record. One date holds at most one
      // weigh-in, so a destination that already has one is updated and the record left behind is
      // removed rather than duplicated onto the new date.
      const moved=initial&&initial.date!==values.date?initial:undefined;
      const target=existing??moved??initial;
      await run(async()=>{
        await store.mutate({
          kind:'weight',
          recordId:target?.id??crypto.randomUUID(),
          expectedRevision:target?.revision??0,
          data:{date:values.date,kg:parseWeight(values.kg,units.weight),context:values.context||null},
          delete:false,
        });
        if(moved&&target?.id!==moved.id)
          await store.mutate({kind:'weight',recordId:moved.id,expectedRevision:moved.revision,data:moved,delete:true});
      });
      onClose();
    }catch(ex){setError((ex as Error).message);}
  };

  return <Modal
    open={open}
    onClose={onClose}
    restoreFocus={restoreFocus}
    title={initial?'Edit weigh-in':'Log weight'}
    description="Record the scale weight for a calendar date."
    dirty={dirty}
    width="sm"
  >
    <Form onSubmit={save} className="dialog-form">
      <div className="form-grid">
        <DatePicker id="weight-entry-date" name="date" min="2000-01-01" label="Weigh-in date" value={values.date} max={current} required onChange={next=>setValues(previous=>({...previous,date:next,context:''}))}/>
        <Field id="weight-entry-kg" name="kg" data-modal-autofocus enterKeyHint="done" label={`Weight (${weightLabel(units.weight)})`} type="number" min={units.weight==='lb'?44.1:20} max={units.weight==='lb'?881.8:400} step="0.01" required value={values.kg} onChange={event=>setValues(previous=>({...previous,kg:event.target.value,context:''}))}/>
      </div>
      {unusual&&<section className="weight-context-prompt" aria-labelledby="weight-context-heading">
        <h3 id="weight-context-heading">This differs from your recent weigh-ins</h3>
        <p>A selected temporary factor keeps this scale value in history but excludes it from calorie-estimation trends. Other answers use the existing statistical filter; a reason never adds or subtracts calories directly.</p>
        <Select
          id="weight-entry-context"
          label="Possible temporary context"
          value={values.context}
          placeholder="Choose an optional context"
          options={[{value:'',label:'No context'},...weightContextOptions]}
          onChange={context=>setValues(previous=>({...previous,context:context as typeof previous.context}))}
        />
      </section>}
      <p className="source">{initial?'Changing the date moves this weigh-in. A date that already has one is updated instead.':'A date with an existing weigh-in is updated.'}</p>
      {error&&<p role="alert" className="error">{error}</p>}
      <div className="modal-actions"><Button type="submit" variant="primary" disabled={busy}>{busy?'Saving…':existing||initial?'Update weigh-in':'Save weigh-in'}</Button></div>
    </Form>
  </Modal>;
}
