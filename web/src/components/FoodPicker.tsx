import {useEffect,useRef,useState} from 'react';
import {Camera, Star} from 'lucide-react';
import type {EnergyUnit,Nutrients} from '../types';
import {api} from '../lib/api';
import {Button} from './ui/Button';
import {Field} from './ui/Field';
import {Form} from './ui/Form';
import {BarcodeCamera} from './BarcodeCamera';
import {displayEnergy,energyLabel} from '../lib/units';

type SearchResult = Nutrients & {servingGrams:number};

export interface FoodPickerProps {
  tab:'search'|'barcode';
  query:string;
  setQuery:(q:string)=>void;
  results:SearchResult[];
  setResults:(r:SearchResult[])=>void;
  busy:boolean;
  error:string;
  setError:(err:string)=>void;
  camera:boolean;
  setCamera:(v:boolean|((prev:boolean)=>boolean))=>void;
  onChoose:(food:SearchResult)=>void;
  onSaveFood?:(food:SearchResult)=>void;
  isSaved?:(food:SearchResult)=>boolean;
  onToggleSave?:(food:SearchResult)=>void;
  run:(fn:()=>Promise<void>)=>Promise<void>;
  open:boolean;
  step:string;
  energyUnit?:EnergyUnit;
}

export function FoodPicker({
  tab,
  query,
  setQuery,
  results,
  setResults,
  busy,
  error: _error,
  setError,
  camera,
  setCamera,
  onChoose,
  onSaveFood: _onSaveFood,
  isSaved,
  onToggleSave,
  run,
  open,
  step,
  energyUnit='kcal',
}:FoodPickerProps){
  const requestId=useRef(0);
  useEffect(()=>{requestId.current++;return()=>{requestId.current++;};},[tab,step,open,query]);
  const [scannedCode,setScannedCode]=useState<string>();

  const lookup=(value:string,barcode:boolean)=>{
    const id=++requestId.current;
    return run(async()=>{
      try{
        const found=barcode
          ?[await api<SearchResult>('/foods/barcode/'+encodeURIComponent(value))]
          :await api<SearchResult[]>('/foods/search?q='+encodeURIComponent(value));
        if(id===requestId.current)setResults(found);
      }catch(error){
        if(id===requestId.current)throw error;
      }
    });
  };

  // A scanned code fills the field and looks itself up. The lookup waits for the
  // committed query so the effect above cannot retire its own request as stale.
  useEffect(()=>{
    if(scannedCode===undefined||scannedCode!==query)return;
    setScannedCode(undefined);
    void lookup(scannedCode,true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[scannedCode,query]);

  return <>
    <h3>{tab==='barcode'?'Packaged food':'Food search'}</h3>

    {/* Scanning leads this tab and takes the initial focus. Autofocusing the
        digit field instead raises a phone keyboard over the scanner, and its
        required-field error would shift the camera button out from under a
        pointer that is already pressing it. */}
    {tab==='barcode'&&<>
      <div className="barcode-scan-options">
        <Button variant="primary" data-modal-autofocus onClick={()=>setCamera(value=>!value)}>
          <Camera size={18}/>{camera?'Stop camera':'Scan barcode with camera'}
        </Button>
        <small>The camera stops on the first barcode it reads and looks it up. Type the digits below if the code will not scan.</small>
      </div>
      {camera&&open&&step==='selection'&&<BarcodeCamera
        onDetected={code=>{
          setCamera(false);
          setQuery(code);
          setScannedCode(code);
        }}
        onError={message=>{
          setError(message);
          setCamera(false);
        }}
      />}
    </>}

    <Form onSubmit={event=>{
      event.preventDefault();
      void lookup(query,tab==='barcode');
    }}>
      <div className="search-line">
        <Field
          id="food-search-input"
          name="query"
          key={tab}
          validate={()=>tab==='barcode'&&!/^[0-9]{8,14}$/.test(query)?'Enter an 8–14 digit barcode.':tab==='search'&&(query.trim().length<2||query.trim().length>100)?'Enter 2–100 characters.':undefined}
          inputMode={tab==='barcode'?'numeric':undefined}
          data-modal-autofocus={tab==='search'?true:undefined}
          label={tab==='barcode'?'Barcode digits':'Search term'}
          required
          value={query}
          onChange={event=>setQuery(event.target.value)}
          action={<Button variant="primary" type="submit" disabled={busy}>{busy?'Searching…':'Search'}</Button>}
        />
      </div>
    </Form>

    {results.map((result,index)=>{
      const starred=isSaved?isSaved(result):false;
      return <div
        className="food-row interactive"
        key={`${result.source}|${result.name}|${index}`}
        role="button"
        tabIndex={0}
        onClick={()=>onChoose(result)}
        onKeyDown={event=>{
          if(event.target!==event.currentTarget)return;
          if(event.key==='Enter'||event.key===' '){
            event.preventDefault();
            onChoose(result);
          }
        }}
      >
        <div className="food-description">
          <strong>{result.name}</strong>
          <small>{displayEnergy(result.calories,energyUnit)} {energyLabel(energyUnit)} / 100 g · {result.source}</small>
        </div>
        <Button
          variant="tertiary"
          className={`food-row-star ${starred?'starred':''}`}
          aria-label={starred?`Remove ${result.name} from saved foods`:`Save ${result.name} to your foods`}
          onClick={event=>{
            event.stopPropagation();
            onToggleSave?.(result);
          }}
        >
          <Star size={18} fill={starred?'currentColor':'none'}/>
        </Button>
      </div>;
    })}
  </>;
}
