import {useEffect,useRef,useState,type ChangeEvent,type FormEvent} from 'react';
import type {NutritionStore} from '../useNutritionStore';
import type {BodyDraft,BodyMeasurementKey,BodyRecord,BodyWeightContext,PhysiqueAngle,PhysiquePhoto} from '../types';
import {api} from '../lib/api';
import {number,readableDate,today} from '../lib/format';
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
import {allMeasurementKeys,angleLabel,angles,circumferenceUnitFor,fromCentimetres,measurementGroups,measurementLabel,photoContentUrl,toCentimetres} from '../lib/bodyMeasurements';
import {buildEstimateRequest} from '../lib/bodyFatEstimate';
import {BodyFatEstimate} from './body/BodyFatEstimate';
import {useOnlineStatus} from './ui/useOnlineStatus';

async function captureBodyContext(store:NutritionStore,date:string):Promise<BodyWeightContext>{
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

type BodySlot={angle:PhysiqueAngle;id:string;existing?:PhysiquePhoto;imageBase64?:string;changed:boolean;deleted:boolean};

function makeBodySlots(record?:BodyRecord):BodySlot[]{
  return angles.map(angle=>{
    const existing=record?.photos.find(photo=>photo.angle===angle&&photo.status!=='deleted');
    return {angle,id:existing?.id??crypto.randomUUID(),existing,changed:false,deleted:false};
  });
}

export interface BodyRecordDialogProps{
  open:boolean;
  record?:BodyRecord;
  previousRecord?:BodyRecord;
  photoSet?:boolean;
  store:NutritionStore;
  restoreFocus?:HTMLElement|null;
  onClose:()=>void;
}

export function BodyRecordDialog({open,record,previousRecord,photoSet=false,store,restoreFocus,onClose}:BodyRecordDialogProps){
  const current=today(store.state!.profile?.timeZone);
  const defaultUnit=circumferenceUnitFor(unitsFor(store.state!.settings).weight);
  const [date,setDate]=useState(current);
  const [unit,setUnit]=useState<'cm'|'in'>(defaultUnit);
  const [values,setValues]=useState<Record<BodyMeasurementKey,string>>(()=>Object.fromEntries(allMeasurementKeys.map(k=>[k,''])) as Record<BodyMeasurementKey,string>);
  const [slots,setSlots]=useState<BodySlot[]>(()=>makeBodySlots());
  const [omitScale,setOmitScale]=useState(false);
  const [omitTrend,setOmitTrend]=useState(false);
  const [confirmDelete,setConfirmDelete]=useState(false);
  const [error,setError]=useState('');
  const {busy,run,reset,pending:busyPending}=useAsyncAction();
  const online=useOnlineStatus();
  const initialRef=useRef({date,values});
  // Exact centimetres behind each field, and which fields the person typed in. Toggling units re-displays from
  // the exact value, and saving sends only typed fields, so a tab flip never rounds a measurement they left alone.
  const exactCm=useRef<Partial<Record<BodyMeasurementKey,number>>>({});
  const editedKeys=useRef(new Set<BodyMeasurementKey>());

  useEffect(()=>{
    if(!open)return;
    const initialUnit=defaultUnit;
    const nextValues=Object.fromEntries(allMeasurementKeys.map(key=>{
      const val=record?.measurements[key];
      if(val==null)return [key,''];
      if(key==='bodyFatPercent')return [key,String(val)];
      return [key,initialUnit==='in'?String(Math.round(fromCentimetres(val,'in')*10)/10):String(val)];
    })) as Record<BodyMeasurementKey,string>;
    exactCm.current=Object.fromEntries(allMeasurementKeys.filter(key=>key!=='bodyFatPercent'&&record?.measurements[key]!=null).map(key=>[key,record!.measurements[key]!]));
    editedKeys.current=new Set();
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
    initialRef.current={date:record?.date??current,values:nextValues};
  },[open,record?.id,current,defaultUnit,reset]);

  const handleUnitToggle=(nextUnit:'cm'|'in')=>{
    if(nextUnit===unit)return;
    setValues(prev=>{
      const converted={...prev};
      for(const key of allMeasurementKeys){
        const exact=exactCm.current[key];
        if(key==='bodyFatPercent'||exact==null||!prev[key].trim())continue;
        converted[key]=String(Math.round(fromCentimetres(exact,nextUnit)*10)/10);
      }
      return converted;
    });
    setUnit(nextUnit);
  };

  const hasPreviousMeasurements=!record&&Boolean(previousRecord&&allMeasurementKeys.some(key=>previousRecord.measurements[key]!=null));
  const copyPreviousMeasurements=()=>{
    if(!previousRecord)return;
    setValues(prev=>{
      const next={...prev};
      for(const key of allMeasurementKeys){
        const val=previousRecord.measurements[key];
        if(val==null)continue;
        if(key==='bodyFatPercent'){
          next[key]=String(val);
        }else{
          exactCm.current[key]=val;
          editedKeys.current.add(key);
          next[key]=unit==='in'?String(Math.round(fromCentimetres(val,'in')*10)/10):String(val);
        }
      }
      return next;
    });
  };
  const previousCircumferenceHint=(key:BodyMeasurementKey)=>{
    const cm=previousRecord?.measurements[key];
    if(cm==null)return undefined;
    return `Previous: ${number(fromCentimetres(cm,unit),1)} ${unit}`;
  };
  const previousBodyFat=previousRecord?.measurements.bodyFatPercent;
  const previousBodyFatHint=previousBodyFat!=null?`Previous (${readableDate(previousRecord!.date)}): ${number(previousBodyFat,1)}%`:undefined;

  const dirty=omitScale||omitTrend||date!==initialRef.current.date||values.bodyFatPercent!==initialRef.current.values.bodyFatPercent||editedKeys.current.size>0||slots.some(s=>s.changed||s.deleted);

  const selectPhoto=async(photoAngle:PhysiqueAngle,event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.currentTarget.files?.[0];
    event.currentTarget.value='';
    if(!file){
      setSlots(curr=>curr.map(slot=>slot.angle===photoAngle?{...slot,imageBase64:undefined,changed:false}:slot));
      setError('');
      return;
    }
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
    if(busyPending)return;
    const measurements:Record<string,number|null>={};
    for(const key of allMeasurementKeys){
      const raw=values[key].trim();
      if(!record&&raw==='')continue;
      // Untouched fields keep their stored value exactly; only typed ones are converted and sent.
      if(photoSet||record&&(key==='bodyFatPercent'?raw===initialRef.current.values[key]:!editedKeys.current.has(key)))continue;
      if(raw===''){
        measurements[key]=null;
      }else{
        const num=Number(raw);
        if(!Number.isFinite(num)){
          measurements[key]=null;
        }else{
          measurements[key]=key==='bodyFatPercent'?Math.round(num*10)/10:toCentimetres(exactCm.current[key]??num,'cm');
        }
      }
    }

    const photos=slots.filter(s=>s.changed&&s.imageBase64).map(s=>({id:s.id,angle:s.angle,imageBase64:s.imageBase64!}));
    const removePhotoIds=slots.filter(s=>s.deleted&&s.existing).map(s=>s.existing!.id);
    const keepsPhoto=slots.some(slot=>slot.imageBase64||slot.existing&&!slot.deleted);
    const keepsMeasurement=allMeasurementKeys.some(key=>(key in measurements?measurements[key]:record?.measurements[key])!=null);
    if(photoSet&&!keepsPhoto||!photoSet&&!keepsPhoto&&!keepsMeasurement){
      setError(photoSet?(record?'Use Delete photo set to remove its last view.':'Choose at least one photo before saving.'):
        record?'Keep at least one measurement or photo, or delete the record.':'Add at least one measurement or photo before saving.');
      return;
    }
    setError('');
    try{
      await run(async()=>{
        const weightContext=record||photoSet?undefined:await captureBodyContext(store,date);
        await store.saveBodyDraft({
          id:record?.id??crypto.randomUUID(),date,measurements,photos,photoSet,removePhotoIds:removePhotoIds.length?removePhotoIds:undefined,
          mutationId:crypto.randomUUID(),photoMutationId:photos.length?crypto.randomUUID():undefined,
          weightContext,omitScale,omitTrend,expectedRevision:record?.revision??0
        });
      });
      onClose();
    }catch(ex){
      setError((ex as Error).message);
    }
  };

  const keepsMeasurements=record&&allMeasurementKeys.some(key=>record.measurements[key]!=null);
  const deleteLabel=photoSet?'Delete photo set':'Delete record';
  const deleteRecord=async()=>{
    if(!record||busyPending)return;
    setError('');
    try{
      const removeViews=photoSet&&keepsMeasurements;
      const draft:BodyDraft={id:record.id,date:record.date,measurements:{},photos:[],photoSet,
        action:removeViews?'save':'delete',removePhotoIds:removeViews?record.photos.map(photo=>photo.id):undefined,
        mutationId:crypto.randomUUID(),expectedRevision:record.revision};
      await run(()=>store.saveBodyDraft(draft));
      setConfirmDelete(false);
      onClose();
    }catch(ex){
      setError((ex as Error).message);
    }
  };

  const title=photoSet?(record?'Edit physique photo set':'Upload physique photo set'):(record?'Edit body record':'Add body record');
  return <Modal open={open} onClose={onClose} restoreFocus={restoreFocus} title={title} description={photoSet&&keepsMeasurements?'This photo set shares its date with a measurement record.':undefined} dirty={dirty} preventDismiss={busyPending} width={photoSet?'lg':'xl'} className={photoSet?'photo-upload-dialog':undefined}>
    <Form onSubmit={save} className="dialog-form body-record-form">
      <div className="body-record-form-top">
        <DatePicker id="body-date" name="date" min="2000-01-01" max={current} required label={photoSet?'Photo date':'Record date'} value={date} onChange={setDate}/>
        {!photoSet&&<div className="field body-unit-toggle-field">
          <span>Circumference unit</span>
          <SegmentedControl<'cm'|'in'> id="body-circumference-unit" label="Circumference unit" value={unit} onChange={handleUnitToggle} options={[{value:'cm',label:'cm'},{value:'in',label:'in'}]}/>
        </div>}
      </div>

      {!photoSet&&<section className="body-form-section body-composition-section">
        <div className="body-form-section-header">
          <h3>Body fat</h3>
          <div className="body-form-section-actions">
            {hasPreviousMeasurements&&<Button type="button" variant="secondary" size="sm" disabled={busyPending} onClick={copyPreviousMeasurements}>Copy previous measurements</Button>}
            <span className="unit-indicator">%</span>
          </div>
        </div>
        <div className="body-field-grid body-composition-grid">
          <Field id="body-bodyFatPercent" type="number" min="0.1" max="99.9" step="0.1" label="Body fat (%)" hint={previousBodyFatHint} value={values.bodyFatPercent} onChange={e=>{const value=e.currentTarget.value;setValues(cv=>({...cv,bodyFatPercent:value}));}}/>
          <BodyFatEstimate slots={slots} online={online} disabled={busyPending} request={buildEstimateRequest(date,slots,values,unit)} onUse={percent=>setValues(cv=>({...cv,bodyFatPercent:String(percent)}))}/>
        </div>
      </section>}

      {!photoSet&&measurementGroups.map(([group,keys])=><section className="body-form-section" key={group}>
        <div className="body-form-section-header"><h3>{group}</h3><span className="unit-indicator">{unit}</span></div>
        <div className="body-field-grid">
          {keys.map(key=><Field key={key} id={'body-'+key} type="number" min="0.1" max={fromCentimetres(250,unit)} step="any" label={`${measurementLabel(key)} (${unit})`} hint={previousCircumferenceHint(key)} value={values[key]} onChange={e=>{const val=e.currentTarget.value;editedKeys.current.add(key);const num=Number(val);if(val.trim()!==''&&Number.isFinite(num))exactCm.current[key]=unit==='in'?num*2.54:num;else delete exactCm.current[key];setValues(cv=>({...cv,[key]:val}));}}/>)}
        </div>
      </section>)}

      <section className="body-form-section body-photo-section">
        <div className="body-form-section-header"><h3>Photos</h3>
          {!photoSet&&<p className="source">Optional. Add, replace, or remove each view individually.</p>}
          {photoSet&&!record&&<p className="source">Choose at least one view.</p>}
        </div>
        <div className="physique-upload-grid">
          {slots.map(slot=>{
            const preview=slot.imageBase64?'data:image/jpeg;base64,'+slot.imageBase64:slot.existing?.status==='complete'&&!slot.deleted?photoContentUrl(slot.existing):undefined;
            return <section className="physique-upload-slot" key={slot.angle}>
              <div className="physique-upload-slot-heading">
                {photoSet?<h3>{angleLabel(slot.angle)}</h3>:<h4>{angleLabel(slot.angle)}</h4>}
                {slot.existing&&!slot.changed&&<Button type="button" variant={slot.deleted?'tertiary':'destructive'} size="sm" disabled={busyPending} onClick={()=>setSlots(curr=>curr.map(item=>item.angle===slot.angle?{...item,deleted:!item.deleted}:item))}>{slot.deleted?'Undo removal':'Remove view'}</Button>}
              </div>
              {preview&&<img className="photo-preview" src={preview} alt={`${slot.changed?'Selected':'Current'} ${slot.angle} physique photo`}/>}
              {slot.deleted?<p className="source">Will be removed on save.</p>:!preview&&slot.existing?<p className="source">Upload pending</p>:null}
              <FileInput id={'body-photo-'+slot.angle} name={'body-photo-'+slot.angle} disabled={busyPending} label={angleLabel(slot.angle)+' photo'} accept="image/*" onChange={e=>void selectPhoto(slot.angle,e)}/>
            </section>;
          })}
        </div>
      </section>

      {!photoSet&&<section className="body-form-section body-context-section">
        <div className="body-form-section-header"><h3>Weight context</h3><p className="source">Captured when this record is saved. Missing values stay unavailable.</p></div>
        <div className="body-context-switches">
          <Checkbox id="body-omit-scale" role="switch" checked={omitScale} onChange={setOmitScale}>Omit scale snapshot</Checkbox>
          <Checkbox id="body-omit-trend" role="switch" checked={omitTrend} onChange={setOmitTrend}>Omit trend snapshot</Checkbox>
        </div>
      </section>}

      {error&&<p role="alert" className="error">{error}</p>}
      <div className="modal-actions">
        {record&&<Button type="button" variant="destructive" disabled={busyPending} onClick={()=>{setError('');setConfirmDelete(true);}}>{deleteLabel}</Button>}
        <Button type="submit" variant="primary" disabled={busyPending||Boolean(record&&!dirty)}>{busy?'Saving…':photoSet?'Save photo set':'Save Body record'}</Button>
      </div>
    </Form>
    <Modal open={confirmDelete} onClose={()=>setConfirmDelete(false)} preventDismiss={busyPending} title={photoSet?'Delete photo set?':'Delete Body record?'} description={record?`${readableDate(record.date)} · ${photoSet&&keepsMeasurements?'Remove all photo views and keep the measurements.':'Remove the record and its private photo views.'}`:undefined} width="sm">
      {error&&<p role="alert" className="error">{error}</p>}
      <div className="modal-actions">
        <Button variant="secondary" disabled={busyPending} onClick={()=>setConfirmDelete(false)}>{photoSet?'Keep photo set':'Keep record'}</Button>
        <Button variant="destructive" disabled={busyPending} onClick={()=>void deleteRecord()}>{deleteLabel}</Button>
      </div>
    </Modal>
  </Modal>;
}
