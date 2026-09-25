import {useEffect,useRef,useState} from 'react';
import {createFoodScanDraft,type FoodScanDraft} from '../lib/foodScans';
import {deleteFoodScanDraft,foodBasketDraftKey,readFoodScanDraft,saveFoodScanDraft} from '../lib/local';

export type AiMode='photo'|'label'|'description';
export type PendingBarcode={code:string;purpose:'log'|'recipe'};

/**
 * The AI scan inputs for one diary date, persisted on this device before any
 * upload so a reload or crash never loses a captured photo or a reviewed result.
 */
export function useFoodScanDraft({open,accountId,date,pendingBarcode,onRestore}:{
  open:boolean;
  accountId:string;
  date:string;
  pendingBarcode:PendingBarcode|undefined;
  /** Called with null when a date opens, then with any saved scan found for it. */
  onRestore:(saved:FoodScanDraft|null)=>void;
}){
  const [description,setDescription]=useState('');
  const [mode,setMode]=useState<AiMode>('description');
  const [photo,setPhoto]=useState<string|null>(null);
  const [scanDraft,setScanDraft]=useState<FoodScanDraft|null>(null);
  const scanDraftRef=useRef<FoodScanDraft|null>(null);
  const [loadedKey,setLoadedKey]=useState<string|null>(null);
  const [storageError,setStorageError]=useState('');
  const writes=useRef<Promise<void>>(Promise.resolve());
  const onRestoreRef=useRef(onRestore);
  useEffect(()=>{onRestoreRef.current=onRestore;});

  const persist=(next:FoodScanDraft)=>{
    const write=writes.current.catch(()=>undefined).then(()=>saveFoodScanDraft(accountId,next));
    writes.current=write;
    return write.then(()=>{
      scanDraftRef.current=next;
      setScanDraft(next);
      setStorageError('');
    });
  };
  const remove=async(targetDate=date)=>{
    const write=writes.current.catch(()=>undefined).then(()=>deleteFoodScanDraft(accountId,targetDate));
    writes.current=write;
    await write;
    if(targetDate===date){scanDraftRef.current=null;setScanDraft(null);setStorageError('');}
  };

  useEffect(()=>{
    if(!open)return;
    let current=true;
    const key=foodBasketDraftKey(accountId,date);
    setLoadedKey(null);
    setScanDraft(null);
    scanDraftRef.current=null;
    setStorageError('');
    setDescription('');setMode('description');setPhoto(null);onRestoreRef.current(null);
    void readFoodScanDraft(accountId,date).then(saved=>{
      if(!current)return;
      if(saved){
        scanDraftRef.current=saved;
        setScanDraft(saved);
        setDescription(saved.description);
        setMode(saved.mode);
        setPhoto(saved.imageBase64);
        onRestoreRef.current(saved);
      }
    }).catch(()=>{
      if(current)setStorageError('This device could not check for a saved scan. Keep this screen open until the scan has been reviewed.');
    }).finally(()=>{
      if(current)setLoadedKey(key);
    });
    return()=>{current=false;};
  },[open,accountId,date]);

  useEffect(()=>{
    if(!open||loadedKey!==foodBasketDraftKey(accountId,date))return;
    const current=scanDraftRef.current;
    const hasContent=!!photo||!!description.trim()||!!pendingBarcode;
    const matchesSavedReview=current?.status==='review'&&current.date===date&&current.mode===mode&&
      current.description===description&&current.imageBase64===(mode==='description'?null:photo)&&
      JSON.stringify(current.pendingBarcode??null)===JSON.stringify(pendingBarcode??null);
    if(matchesSavedReview)return;
    if(!hasContent){
      if(current?.status==='captured'){
        const timer=window.setTimeout(()=>{void remove(date).catch(()=>setStorageError('The saved scan could not be cleared from this device.'));},250);
        return()=>window.clearTimeout(timer);
      }
      return;
    }
    const sameInput=current?.date===date&&current.mode===mode&&current.description===description&&
      current.imageBase64===(mode==='description'?null:photo)&&
      JSON.stringify(current.pendingBarcode??null)===JSON.stringify(pendingBarcode??null);
    const canContinueCaptured=current?.status==='captured'&&current.date===date;
    const base=sameInput?current:canContinueCaptured?current:createFoodScanDraft({
      date,mode,description,imageBase64:mode==='description'?null:photo,pendingBarcode:pendingBarcode?{...pendingBarcode}:undefined
    });
    const next={...base,mode,description,imageBase64:mode==='description'?null:photo,pendingBarcode:pendingBarcode?{...pendingBarcode}:undefined};
    const timer=window.setTimeout(()=>{void persist(next).catch(()=>setStorageError('The scan draft could not be saved on this device. It will not upload until it can be saved.'));},250);
    return()=>window.clearTimeout(timer);
  },[open,loadedKey,accountId,date,mode,description,photo,pendingBarcode]);

  /** Saves a prepared photo to the device before it becomes the active input. */
  const attachPhoto=async(imageBase64:string)=>{
    const current=scanDraftRef.current;
    const next=current?.status==='captured'&&current.date===date&&current.mode===mode
      ?{...current,description,imageBase64,pendingBarcode:pendingBarcode?{...pendingBarcode}:undefined}
      :createFoodScanDraft({date,mode,description,imageBase64,pendingBarcode:pendingBarcode?{...pendingBarcode}:undefined});
    await persist(next);
    setPhoto(imageBase64);
  };

  const ready=loadedKey===foodBasketDraftKey(accountId,date);
  const hasSavedReview=scanDraft?.date===date&&scanDraft.mode===mode&&scanDraft.status==='review'&&!!scanDraft.resultJson&&
    scanDraft.description===description&&JSON.stringify(scanDraft.pendingBarcode??null)===JSON.stringify(pendingBarcode??null);

  return {
    description,setDescription,mode,setMode,photo,setPhoto,
    scanDraft,scanDraftRef,ready,hasSavedReview,storageError,setStorageError,
    persist,remove,attachPhoto,
  };
}
