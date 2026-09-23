import {useEffect,useRef,useState,type ChangeEvent,type FormEvent} from 'react';
import type {Nourish} from '../useNourish';
import type {BodyDraft,BodyMeasurementKey,BodyRecord,BodyWeightContext,PhysiqueAngle,PhysiquePhoto} from '../types';
import {api} from '../lib/api';
import {today} from '../lib/format';
import {Button} from './ui/Button';
import {Checkbox} from './ui/Checkbox';
import {Modal} from './ui/Modal';
import {SegmentedControl} from './ui/SegmentedControl';
import {useAsyncAction} from './ui/useAsyncAction';
import {Form} from './ui/Form';
import {DatePicker} from './ui/DatePicker';
import {Field} from './ui/Field';
import {FileInput} from './ui/FileInput';
import {prepareImage} from '../lib/image';
import {unitsFor} from '../lib/units';

export const angles:PhysiqueAngle[]=['front','side','back'];
export const angleLabel=(angle:PhysiqueAngle)=>angle[0].toUpperCase()+angle.slice(1);
export const measurementGroups:[string,BodyMeasurementKey[]][]=[
  ['Core',['neckCm','shouldersCm','chestCm','waistCm','hipsCm']],
  ['Arms',['leftBicepsCm','rightBicepsCm','leftForearmCm','rightForearmCm']],
  ['Legs',['leftThighCm','rightThighCm','leftCalfCm','rightCalfCm']]
];
export const measurementLabel=(key:BodyMeasurementKey)=>({
  neckCm:'Neck',shouldersCm:'Shoulders',chestCm:'Chest',waistCm:'Waist',hipsCm:'Hips',
  leftBicepsCm:'Left biceps',rightBicepsCm:'Right biceps',leftForearmCm:'Left forearm',rightForearmCm:'Right forearm',
  leftThighCm:'Left thigh',rightThighCm:'Right thigh',leftCalfCm:'Left calf',rightCalfCm:'Right calf',bodyFatPercent:'Body fat'
}[key]);
export const allMeasurementKeys:BodyMeasurementKey[]=measurementGroups.flatMap(([,keys])=>keys).concat('bodyFatPercent');

export async function captureBodyContext(store:Nourish,date:string):Promise<BodyWeightContext>{
  if(navigator.onLine){
    try{return await api<BodyWeightContext>('/body-records/weight-context?date='+encodeURIComponent(date));}
    catch{/* Fall back to retained local values */}
  }
  const state=store.state;
  const scale=[...(state?.weights??[])].filter(w=>!w.deleted&&w.date<=date).sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
  const cachedPoints=Object.values(store.local?.progress??{}).flatMap(summary=>summary.weight.series).filter(point=>point.date<=date).sort((a,b)=>a.date.localeCompare(b.date));
  const trend=cachedPoints.at(-1);
  return {scaleKg:scale?.kg??null,scaleDate:scale?.date??null,trendKg:trend?.trendKg??null,trendDate:trend?.date??null,capturedAt:new Date().toISOString(),calculationVersion:'coach-trend-half-life-7d-v1',provenance:'cached'};
}

export type BodySlot={angle:PhysiqueAngle;id:string;existing?:PhysiquePhoto;imageBase64?:string;changed:boolean;deleted:boolean;fileKey:number};

export function makeBodySlots(record?:BodyRecord):BodySlot[]{
  return angles.map(angle=>{
    const existing=record?.photos.find(photo=>photo.angle===angle&&photo.status!=='deleted');
    return {angle,id:existing?.id??crypto.randomUUID(),existing,changed:false,deleted:false,fileKey:0};
  });
}

export interface BodyRecordDialogProps{
  open:boolean;
  record?:BodyRecord;
  store:Nourish;
  restoreFocus?:HTMLElement|null;
  onClose:()=>void;
}

export function BodyRecordDialog({open,record,store,restoreFocus,onClose}:BodyRecordDialogProps){
  const current=today(store.state!.profile?.timeZone);
  const defaultUnit=unitsFor(store.state!.settings).weight==='lb'?'in':'cm';
  const [date,setDate]=useState(current);
  const [unit,setUnit]=useState<'cm'|'in'>(defaultUnit);
  const [values,setValues]=useState<Record<BodyMeasurementKey,string>>(()=>Object.fromEntries(allMeasurementKeys.map(k=>[k,''])) as Record<BodyMeasurementKey,string>);
  const [slots,setSlots]=useState<BodySlot[]>(()=>makeBodySlots());
  const [omitScale,setOmitScale]=useState(false);
  const [omitTrend,setOmitTrend]=useState(false);
  const [confirmDelete,setConfirmDelete]=useState(false);
  const [error,setError]=useState('');
  const {busy,run,reset}=useAsyncAction();
  const initialRef=useRef({date,values,slots});

  useEffect(()=>{
    if(!open)return;
    const initialUnit=defaultUnit;
    const nextValues=Object.fromEntries(allMeasurementKeys.map(key=>{
      const val=record?.measurements[key];
      if(val==null)return [key,''];
      if(key==='bodyFatPercent')return [key,String(val)];
      return [key,initialUnit==='in'?String(Math.round((val/2.54)*10)/10):String(val)];
    })) as Record<BodyMeasurementKey,string>;
    const nextSlots=makeBodySlots(record);
    setDate(record?.date??current);
    setUnit(initialUnit);
    setValues(nextValues);
    setSlots(nextSlots);
    setOmitScale(false);
    setOmitTrend(false);
    setConfirmDelete(false);
    setError('');
    reset();
    initialRef.current={date:record?.date??current,values:nextValues,slots:nextSlots};
  },[open,record?.id,current,defaultUnit,reset]);

  const handleUnitToggle=(nextUnit:'cm'|'in')=>{
    if(nextUnit===unit)return;
    setValues(prev=>{
      const converted={...prev};
      for(const key of allMeasurementKeys){
        if(key==='bodyFatPercent'||!prev[key].trim())continue;
        const num=Number(prev[key]);
        if(!Number.isFinite(num))continue;
        if(nextUnit==='in'){
          converted[key]=String(Math.round((num/2.54)*10)/10);
        }else{
          converted[key]=String(Math.round((num*2.54)*10)/10);
        }
      }
      return converted;
    });
    setUnit(nextUnit);
  };

  const dirty=date!==initialRef.current.date||allMeasurementKeys.some(k=>values[k]!==initialRef.current.values[k])||slots.some(s=>s.changed||s.deleted);

  const selectPhoto=async(photoAngle:PhysiqueAngle,event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.currentTarget.files?.[0];
    event.currentTarget.value='';
    if(!file)return;
    setError('');
    try{
      const imageBase64=await run(()=>prepareImage(file,750000));
      setSlots(curr=>curr.map(s=>s.angle===photoAngle?{...s,imageBase64,changed:true,deleted:false}:s));
    }catch(ex){
      setError((ex as Error).message);
    }
  };

  const save=async(event:FormEvent)=>{
    event.preventDefault();
    if(busy)return;
    const measurements:Record<string,number|null>={};
    for(const key of allMeasurementKeys){
      const raw=values[key].trim();
      if(!record&&raw==='')continue;
      if(raw===''){
        measurements[key]=null;
      }else{
        const num=Number(raw);
        if(!Number.isFinite(num)){
          measurements[key]=null;
        }else if(key==='bodyFatPercent'||unit==='cm'){
          measurements[key]=Math.round(num*10)/10;
        }else{
          // Convert inches to cm for storage
          measurements[key]=Math.round((num*2.54)*10)/10;
        }
      }
    }

    const photos=slots.filter(s=>s.changed&&s.imageBase64).map(s=>({id:s.id,angle:s.angle,imageBase64:s.imageBase64!}));
    const deletePhotoIds=slots.filter(s=>s.deleted&&s.existing).map(s=>s.existing!.id);

    if(!record&&Object.keys(measurements).length===0&&photos.length===0){
      setError('Add at least one measurement or photo before saving.');
      return;
    }
    setError('');
    try{
      const weightContext=record?undefined:await captureBodyContext(store,date);
      const draft:BodyDraft={
        id:record?.id??crypto.randomUUID(),date,measurements,photos,deletePhotoIds,
        mutationId:crypto.randomUUID(),photoMutationId:photos.length?crypto.randomUUID():undefined,
        deleteMutationIds:Object.fromEntries(deletePhotoIds.map(id=>[id,crypto.randomUUID()])),
        weightContext,omitScale,omitTrend,expectedRevision:record?.revision??0
      };
      await run(()=>store.saveBodyDraft(draft));
      onClose();
    }catch(ex){
      setError((ex as Error).message);
    }
  };

  const deleteRecord=async()=>{
    if(!record)return;
    setError('');
    try{
      const draft:BodyDraft={id:record.id,date:record.date,measurements:{},photos:[],action:'delete',mutationId:crypto.randomUUID(),expectedRevision:record.revision};
      await run(()=>store.saveBodyDraft(draft));
      setConfirmDelete(false);
      onClose();
    }catch(ex){
      setError((ex as Error).message);
    }
  };

  return <Modal open={open} onClose={onClose} restoreFocus={restoreFocus} title={record?'Edit Body record':'Add Body record'} description="Measurements are stored in centimetres. Weight context is captured once by the server and remains reviewable." dirty={dirty} width="xl">
    <Form onSubmit={save} className="dialog-form body-record-form">
      <div className="body-record-form-top">
        <DatePicker id="body-date" name="date" min="2000-01-01" max={current} required label="Record date" value={date} onChange={setDate}/>
        <div className="field body-unit-toggle-field">
          <span>Circumference unit</span>
          <SegmentedControl<'cm'|'in'> id="body-circumference-unit" label="Circumference unit" value={unit} onChange={handleUnitToggle} options={[{value:'cm',label:'cm'},{value:'in',label:'in'}]}/>
        </div>
      </div>

      {measurementGroups.map(([group,keys])=><section className="body-form-section" key={group}>
        <div className="body-form-section-header"><h3>{group}</h3><span className="unit-indicator">{unit}</span></div>
        <div className="body-field-grid">
          {keys.map(key=><Field key={key} id={'body-'+key} type="number" min="0.1" max="400" step="0.1" label={`${measurementLabel(key)} (${unit})`} value={values[key]} onChange={e=>{const val=e.currentTarget.value;setValues(cv=>({...cv,[key]:val}));}}/>)}
        </div>
      </section>)}

      <section className="body-form-section">
        <div className="body-form-section-header"><h3>Composition</h3><span className="unit-indicator">%</span></div>
        <div className="body-field-grid body-composition-grid">
          <Field id="body-bodyFatPercent" type="number" min="0.1" max="99.9" step="0.1" label="Body fat (%)" value={values.bodyFatPercent} onChange={e=>setValues(cv=>({...cv,bodyFatPercent:e.currentTarget.value}))}/>
        </div>
      </section>

      <section className="body-form-section body-context-section">
        <div className="body-form-section-header"><h3>Weight context</h3><p className="source">Captured when this record is saved. Missing values stay unavailable.</p></div>
        <div className="body-context-switches">
          <Checkbox id="body-omit-scale" role="switch" checked={omitScale} onChange={setOmitScale}>Omit scale snapshot</Checkbox>
          <Checkbox id="body-omit-trend" role="switch" checked={omitTrend} onChange={setOmitTrend}>Omit trend snapshot</Checkbox>
        </div>
      </section>

      <section className="body-form-section body-photo-section">
        <div className="body-form-section-header"><h3>Photos</h3><p className="source">Optional. Replace or remove one view without changing the other angles.</p></div>
        <div className="physique-upload-grid">
          {slots.map(slot=>{
            const preview=slot.imageBase64?'data:image/jpeg;base64,'+slot.imageBase64:slot.existing&&!slot.deleted?'/api/photos/'+slot.existing.id+'/content':undefined;
            return <section className="physique-upload-slot" key={slot.angle}>
              <div className="physique-upload-slot-heading">
                <h4>{angleLabel(slot.angle)}</h4>
                {slot.existing&&!slot.deleted&&!slot.changed&&<Button type="button" variant="destructive" size="sm" disabled={busy} onClick={()=>setSlots(curr=>curr.map(item=>item.angle===slot.angle?{...item,deleted:true}:item))}>Delete</Button>}
              </div>
              {preview&&<img className="photo-preview" src={preview} alt={`${slot.changed?'Selected':'Current'} ${slot.angle} physique photo`}/>}
              <FileInput id={'body-photo-'+slot.angle} name={'body-photo-'+slot.angle} key={slot.fileKey} disabled={busy} label={angleLabel(slot.angle)+' photo'} accept="image/*" hint="JPEG or PNG; ≤750 KB." onChange={e=>void selectPhoto(slot.angle,e)}/>
            </section>;
          })}
        </div>
      </section>

      {error&&<p role="alert" className="error">{error}</p>}
      <div className="modal-actions">
        {record&&<Button type="button" variant="destructive" disabled={busy} onClick={()=>setConfirmDelete(true)}>Delete record</Button>}
        <Button type="submit" variant="primary" disabled={busy}>{busy?'Preparing…':'Save Body record'}</Button>
      </div>
    </Form>
    <Modal open={confirmDelete} onClose={()=>setConfirmDelete(false)} title="Delete Body record?" description="The record and its private photo views will be marked for deletion. You can retry cleanup if storage is unavailable." width="sm">
      <div className="modal-actions">
        <Button variant="secondary" onClick={()=>setConfirmDelete(false)}>Keep record</Button>
        <Button variant="destructive" disabled={busy} onClick={()=>void deleteRecord()}>Delete record</Button>
      </div>
    </Modal>
  </Modal>;
}
