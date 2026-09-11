import {Form} from './ui/Form';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {Nourish} from '../useNourish';
import type {Weight} from '../types';
import {today} from '../lib/format';
import {Button} from './ui/Button';
import {Field} from './ui/Field';
import {DatePicker} from './ui/DatePicker';
import {Modal} from './ui/Modal';
import {inputWeight,parseWeight,unitsFor,weightLabel} from '../lib/units';
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
  const [entryDate,setEntryDate]=useState(date??today(store.state!.profile?.timeZone));
  const [kg,setKg]=useState('');
  const {busy,run}=useAsyncAction();
  const [error,setError]=useState('');
  const initialValues=useRef({date:'',kg:''});
  const state=store.state!;
  const current=today(state.profile?.timeZone);
  const units=unitsFor(state.settings);

  useEffect(()=>{
    if(!open)return;
    const existing=initial??state.weights.find(weight=>!weight.deleted&&weight.date===(date??current));
    const nextDate=existing?.date??date??current;
    const nextKg=existing?inputWeight(existing.kg,units.weight,2):'';
    setEntryDate(nextDate);setKg(nextKg);setError('');
    initialValues.current={date:nextDate,kg:nextKg};
  },[open,initial?.id,date]);

  const existing=state.weights.find(weight=>!weight.deleted&&weight.date===entryDate);
  const dirty=entryDate!==initialValues.current.date||kg!==initialValues.current.kg;
  const save=async(event:FormEvent)=>{
    event.preventDefault();if(busy)return;
    setError('');
    try{
      // Editing a weigh-in and changing its date moves that record. One date holds at most one
      // weigh-in, so a destination that already has one is updated and the record left behind is
      // removed rather than duplicated onto the new date.
      const moved=initial&&initial.date!==entryDate?initial:undefined;
      const target=existing??moved??initial;
      await run(async()=>{
        await store.mutate({
          kind:'weight',
          recordId:target?.id??crypto.randomUUID(),
          expectedRevision:target?.revision??0,
          data:{date:entryDate,kg:parseWeight(kg,units.weight)},
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
        <DatePicker id="weight-entry-date" name="date" min="2000-01-01" label="Weigh-in date" value={entryDate} max={current} required onChange={setEntryDate}/>
        <Field id="weight-entry-kg" name="kg" data-modal-autofocus label={`Weight (${weightLabel(units.weight)})`} type="number" min={units.weight==='lb'?44.1:20} max={units.weight==='lb'?881.8:400} step="0.01" required value={kg} onChange={event=>setKg(event.target.value)}/>
      </div>
      <p className="source">{initial?'Changing the date moves this weigh-in. A date that already has one is updated instead.':'A date with an existing weigh-in is updated.'}</p>
      {error&&<p role="alert" className="error">{error}</p>}
      <div className="modal-actions"><Button type="submit" variant="primary" disabled={busy}>{busy?'Saving…':existing||initial?'Update weigh-in':'Save weigh-in'}</Button></div>
    </Form>
  </Modal>;
}
