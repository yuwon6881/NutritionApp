import {Form} from './ui/Form';
import {useEffect,useRef,useState,type ChangeEvent,type FormEvent} from 'react';
import type {Nourish} from '../useNourish';
import {prepareImage} from '../lib/image';
import {number,today} from '../lib/format';
import {Button} from './ui/Button';
import {Field,SelectField} from './ui/Field';
import {DatePicker} from './ui/DatePicker';
import {FileInput} from './ui/FileInput';
import {Modal} from './ui/Modal';

export interface PhotoUploadDialogProps {
  open:boolean;
  store:Nourish;
  onClose:()=>void;
  restoreFocus?:HTMLElement|null;
}

export function PhotoUploadDialog({open,store,onClose,restoreFocus}:PhotoUploadDialogProps){
  const current=today(store.state!.profile?.timeZone);
  const [date,setDate]=useState(current);
  const [caption,setCaption]=useState('');
  const [angle,setAngle]=useState('front');
  const [image,setImage]=useState<string>();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [fileKey,setFileKey]=useState(0);
  const initial=useRef({date:current,caption:'',angle:'front',image:''});

  useEffect(()=>{
    if(!open)return;
    setDate(current);setCaption('');setAngle('front');setImage(undefined);setError('');setFileKey(key=>key+1);
    initial.current={date:current,caption:'',angle:'front',image:''};
  },[open,current]);

  const dirty=date!==initial.current.date||caption!==initial.current.caption||angle!==initial.current.angle||!!image!==!!initial.current.image;
  const select=async(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.currentTarget.files?.[0];event.currentTarget.value='';
    if(!file){setImage(undefined);return;}
    setBusy(true);setError('');
    try{setImage(await prepareImage(file,750000));}catch(ex){setError((ex as Error).message);}finally{setBusy(false);}
  };
  const save=async(event:FormEvent)=>{
    event.preventDefault();if(!image||busy)return;
    setBusy(true);setError('');
    try{
      await store.addPhoto({id:crypto.randomUUID(),date,caption,angle,imageBase64:image});
      onClose();
    }catch(ex){setError((ex as Error).message);}finally{setBusy(false);}
  };

  return <Modal
    open={open}
    onClose={onClose}
    restoreFocus={restoreFocus}
    title="Upload physique photo"
    description="Prepare a private progress photo before it is queued for upload."
    dirty={dirty}
    width="md"
  >
    <Form onSubmit={save} className="dialog-form">
      <div className="form-grid">
        <DatePicker id="photo-date" name="date" min="2000-01-01" label="Photo date" max={current} required value={date} onChange={setDate}/>
        <SelectField id="photo-angle" name="angle" label="Photo angle" value={angle} onChange={setAngle}><option value="front">Front</option><option value="side">Side</option><option value="back">Back</option><option value="other">Other</option></SelectField>
      </div>
      <Field id="photo-caption" name="caption" label="Photo caption (optional)" maxLength={160} value={caption} onChange={event=>setCaption(event.target.value)}/>
      <FileInput id="photo-file" name="photo" validate={()=>!image?'Choose a photo before saving.':undefined} key={fileKey} disabled={busy} label="Choose physique photo" accept="image/*" onChange={event=>void select(event)}/>
      {image&&<><img className="photo-preview" src={`data:image/jpeg;base64,${image}`} alt="Your selected physique photo"/><p className="source">{number(image.length*.75/1000)} KB · location metadata removed</p></>}
      {error&&<p role="alert" className="error">{error}</p>}
      <div className="modal-actions"><Button type="submit" variant="primary" disabled={busy}>{busy?'Preparing…':'Save photo draft and upload'}</Button></div>
    </Form>
  </Modal>;
}
