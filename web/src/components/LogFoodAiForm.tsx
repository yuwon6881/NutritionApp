import {Sparkles} from 'lucide-react';
import type {FoodScanDraft} from '../lib/foodScans';
import {Button} from './ui/Button';
import {SelectField,TextArea} from './ui/Field';
import {FileInput} from './ui/FileInput';
import {Form} from './ui/Form';
import type {AiMode,PendingBarcode} from './useFoodScanDraft';

/** AI logging from a description, meal photo, or nutrition label; results stay editable drafts. */
export function LogFoodAiForm({
  date,
  busy,
  pendingBarcode,
  mode,
  onModeChange,
  description,
  onDescriptionChange,
  photo,
  onPhotoFile,
  hasSavedReview,
  scanDraft,
  storageError,
  onSubmit,
  onBackToBarcode,
}:{
  date:string;
  busy:boolean;
  pendingBarcode?:PendingBarcode;
  mode:AiMode;
  onModeChange:(mode:AiMode)=>void;
  description:string;
  onDescriptionChange:(value:string)=>void;
  photo:string|null;
  onPhotoFile:(file:File)=>void;
  hasSavedReview:boolean;
  scanDraft:FoodScanDraft|null;
  storageError:string;
  onSubmit:()=>void;
  onBackToBarcode:()=>void;
}){
  const failed=scanDraft?.date===date&&scanDraft.status==='failed'&&scanDraft.error;
  const interrupted=scanDraft?.error==='Upload interrupted. Try again.';
  const submitLabel=busy?'Estimating…'
    :hasSavedReview?'Review saved estimate'
    :scanDraft?.status==='failed'?(interrupted?'Retry saved scan':'Try again')
    :scanDraft?.status==='submitted'?'Resume saved scan'
    :mode==='label'?'Read nutrition label':'Estimate my meal';
  return <Form onSubmit={onSubmit} className="ai-logging-form">
    {pendingBarcode&&<div className="section-heading"><div><h3>Scan nutrition label</h3><p>Barcode {pendingBarcode.code} · review the extracted values before saving.</p></div><Button type="button" variant="tertiary" onClick={onBackToBarcode}>Back to barcode</Button></div>}
    {!pendingBarcode&&<h3>AI logging</h3>}
    {!pendingBarcode&&<SelectField id="ai-log-mode" name="mode" disabled={busy} label="How would you like to log?" value={mode} onChange={value=>onModeChange(value as AiMode)}><option value="description">Describe my meal</option><option value="photo">Meal photo</option><option value="label">Nutrition label</option></SelectField>}
    {mode==='description'&&<TextArea id="ai-meal-description" name="description" disabled={busy} required label="Meal description and portions" maxLength={3000} value={description} onChange={event=>onDescriptionChange(event.target.value)} placeholder="150 g coconut rice, one egg, sambal, cucumber, peanuts…"/>}
    {mode!=='description'&&<FileInput id="ai-photo-input" name="photo" validate={()=>!photo&&!hasSavedReview?'Choose a photo before continuing.':undefined} key={mode} disabled={busy} label={mode==='label'?'Photograph the nutrition label':'Photograph your food'} accept="image/*" capture="environment" maxSizeLabel="1.5 MB" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)onPhotoFile(file);}}/>}
    {photo&&mode!=='description'&&<p className="notice">Location metadata removed · deleted after processing.</p>}
    {hasSavedReview&&<p className="notice" role="status">This scan is saved on this device and ready for review.</p>}
    {failed&&<p className="notice" role="status">{interrupted?'The photo is retained on this device. Retry will use the same scan identity.':'The previous scan failed. Try again to start a new scan; the failed request will not be duplicated.'}</p>}
    {storageError&&<p className="error" role="alert">{storageError}</p>}
    <div className="modal-actions"><Button variant="primary" disabled={busy||!!storageError} type="submit"><Sparkles size={18}/>{submitLabel}</Button></div>
  </Form>;
}
