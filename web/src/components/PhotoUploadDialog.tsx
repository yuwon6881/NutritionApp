import {Form} from './ui/Form';
import {useEffect,useRef,useState,type ChangeEvent,type FormEvent} from 'react';
import type {Nourish} from '../useNourish';
import type {PhysiqueAngle,PhysiqueDraft,PhysiquePhotoSet} from '../types';
import {prepareImage} from '../lib/image';
import {number,today} from '../lib/format';
import {Button} from './ui/Button';
import {DatePicker} from './ui/DatePicker';
import {FileInput} from './ui/FileInput';
import {Modal} from './ui/Modal';
import {useAsyncAction} from './ui/useAsyncAction';

const angles:PhysiqueAngle[]=['front','side','back'];
const angleLabel=(angle:PhysiqueAngle)=>angle[0].toUpperCase()+angle.slice(1);

type UploadSlot={angle:PhysiqueAngle;id:string;existing?:PhysiquePhotoSet['photos'][number];imageBase64?:string;changed:boolean;fileKey:number};

function makeSlots(initial?:PhysiquePhotoSet):UploadSlot[]{
  return angles.map(angle=>{
    const existing=initial?.photos.find(photo=>photo.angle===angle);
    return {angle,id:existing?.id??crypto.randomUUID(),existing,changed:false,fileKey:0};
  });
}

export interface PhotoUploadDialogProps {
  open:boolean;
  store:Nourish;
  onClose:()=>void;
  restoreFocus?:HTMLElement|null;
  initial?:PhysiquePhotoSet;
}

export function PhotoUploadDialog({open,store,onClose,restoreFocus,initial}:PhotoUploadDialogProps){
  const current=today(store.state!.profile?.timeZone);
  const [date,setDate]=useState(initial?.date??current);
  const [slots,setSlots]=useState<UploadSlot[]>(()=>makeSlots(initial));
  const {busy,run,reset}=useAsyncAction();
  const [error,setError]=useState('');
  const initialDate=useRef(initial?.date??current);

  useEffect(()=>{
    if(!open)return;
    setDate(initial?.date??current);
    setSlots(makeSlots(initial));
    setError('');
    reset();
    initialDate.current=initial?.date??current;
  },[open,current,initial?.id]);

  const dirty=date!==initialDate.current||slots.some(slot=>slot.changed);
  const selectedBytes=slots.reduce((sum,slot)=>sum+(slot.imageBase64?slot.imageBase64.length*.75:0),0);
  const select=async(angle:PhysiqueAngle,event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.currentTarget.files?.[0];
    event.currentTarget.value='';
    if(!file){
      setSlots(currentSlots=>currentSlots.map(slot=>slot.angle===angle?{...slot,imageBase64:undefined,changed:false,fileKey:slot.fileKey+1}:slot));
      return;
    }
    setError('');
    try{
      const imageBase64=await run(()=>prepareImage(file,750000));
      setSlots(currentSlots=>currentSlots.map(slot=>slot.angle===angle?{...slot,imageBase64,changed:true}:slot));
    }catch(ex){setError((ex as Error).message);}
  };
  const save=async(event:FormEvent)=>{
    event.preventDefault();if(busy)return;
    const photos=slots.filter(slot=>slot.changed&&slot.imageBase64).map(slot=>({id:slot.id,angle:slot.angle,imageBase64:slot.imageBase64!}));
    if(!initial&&photos.length===0){setError('Choose at least one front, side, or back photo before saving.');return;}
    if(initial&&photos.length===0&&date===initialDate.current){setError('Choose a new photo or change the photo date before saving.');return;}
    setError('');
    try{
      const draft:PhysiqueDraft={id:initial?.id??crypto.randomUUID(),date,photos};
      await run(()=>store.addPhoto(draft));
      onClose();
    }catch(ex){setError((ex as Error).message);}
  };

  return <Modal
    open={open}
    onClose={onClose}
    restoreFocus={restoreFocus}
    title={initial?'Edit physique photo set':'Upload physique photo set'}
    description={initial?'Replace only the views you changed. Unchanged views stay on the server.':'Add up to three private progress views as one set. Each selected image is compressed before it is queued.'}
    dirty={dirty}
    width="lg"
  >
    <Form onSubmit={save} className="dialog-form">
      <DatePicker id="photo-date" name="date" min="2000-01-01" label="Photo date" max={current} required value={date} onChange={setDate}/>
      <div className="physique-upload-grid" aria-label="Physique photo views">
        {slots.map(slot=>{
          const label=angleLabel(slot.angle);
          const preview=slot.imageBase64?`data:image/jpeg;base64,${slot.imageBase64}`:slot.existing?`/api/photos/${slot.existing.id}/content`:undefined;
          return <section className="physique-upload-slot" key={slot.angle} aria-labelledby={`photo-slot-${slot.angle}`}>
            <div className="physique-upload-slot-heading"><h3 id={`photo-slot-${slot.angle}`}>{label}</h3>{slot.existing&&!slot.changed&&<small>Kept unless replaced</small>}</div>
            {preview&&<img className="photo-preview" src={preview} alt={`${slot.changed?'Selected':'Current'} ${slot.angle} physique photo`}/>}
            <FileInput
              id={`photo-file-${slot.angle}`}
              name={`photo-${slot.angle}`}
              key={slot.fileKey}
              disabled={busy}
              label={`${label} photo`}
              accept="image/*"
              hint="JPEG or PNG; compressed to 750 KB or less."
              onChange={event=>void select(slot.angle,event)}
            />
          </section>;
        })}
      </div>
      {selectedBytes>0&&<p className="source">Selected upload: {number(selectedBytes/1000)} KB · location metadata removed</p>}
      {error&&<p role="alert" className="error">{error}</p>}
      <div className="modal-actions"><Button type="submit" variant="primary" disabled={busy}>{busy?'Preparing…':initial?'Save changed views and upload':'Save photo set and upload'}</Button></div>
    </Form>
  </Modal>;
}
