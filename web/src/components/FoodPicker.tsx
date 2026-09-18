import {useEffect,useRef,useState} from 'react';
import {Camera, Star} from 'lucide-react';
import type {EnergyUnit} from '../types';
import {api,ApiError} from '../lib/api';
import {number} from '../lib/format';
import {Button} from './ui/Button';
import {Field} from './ui/Field';
import {Form} from './ui/Form';
import {BarcodeCamera} from './BarcodeCamera';
import {Modal} from './ui/Modal';
import {displayEnergy,energyLabel} from '../lib/units';

type SearchResult = import('../types').FoodSearchResult;

export function nutritionSummary(result:SearchResult,energyUnit:EnergyUnit='kcal'){
  const serving=result.portions?.[0];
  if(serving){
    const calories=result.servingCalories??result.calories*serving.grams/100;
    const label=/^\d+(?:[.,]\d+)?\s*g$/i.test(serving.label.trim())
      ?`${number(serving.grams,1)} g`
      :`${serving.label} (${number(serving.grams,1)} g)`;
    return `${displayEnergy(calories,energyUnit)} ${energyLabel(energyUnit)} / ${label}`;
  }
  if(result.basis==='per100g'){
    return `${displayEnergy(result.calories,energyUnit)} ${energyLabel(energyUnit)} / 100 g`;
  }
  return 'Basis unavailable';
}

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
  /** Optional account-aware lookup used for offline saved barcode mappings. */
  lookup?:(tab:'search'|'barcode',value:string)=>Promise<SearchResult|SearchResult[]>;
  /** The search field label can name the selection purpose without duplicating the panel. */
  searchLabel?:string;
  /** Lets the owner expose recovery actions for a barcode miss/outage. */
  onBarcodeError?:(code:string,error:ApiError)=>void;
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
  lookup:customLookup,
  searchLabel='Search term',
  onBarcodeError,
  onSaveFood: _onSaveFood,
  isSaved,
  onToggleSave,
  run,
  open,
  step,
  energyUnit='kcal',
}:FoodPickerProps){
  const requestId=useRef(0);
  useEffect(()=>{requestId.current++;return()=>{requestId.current++;};},[tab,step,open]);
  const resolve=async(value:string)=>{
    if(customLookup)return customLookup(tab,value);
    return tab==='barcode'
      ?await api<SearchResult>('/foods/barcode/'+encodeURIComponent(value))
      :await api<SearchResult[]>('/foods/search?q='+encodeURIComponent(value));
  };
  const lookup=(value:string)=>{
    const id=++requestId.current;
    void run(async()=>{try{const valueResult=await resolve(value);const found=Array.isArray(valueResult)?valueResult:[valueResult];if(id===requestId.current)setResults(found);}catch(error){
      if(id===requestId.current&&tab==='barcode'){
        const problem=error instanceof ApiError?error:new ApiError('Barcode lookup unavailable. Scan the label or enter this food manually.',503);
        if([404,422,429,503].includes(problem.status)&&onBarcodeError){onBarcodeError(value,problem);return;}
      }
      if(id===requestId.current)throw error;
    }});
  };

  return <>
    <h3 className="food-search-heading">{tab==='barcode'?'Packaged food':'Food search'}</h3>
    <Form onSubmit={event=>{
      event.preventDefault();
      const id=++requestId.current;
      void run(async()=>{
        try{
          const valueResult=await resolve(query);
          const found=Array.isArray(valueResult)?valueResult:[valueResult];
          if(id===requestId.current)setResults(found);
        }catch(error){
          if(id===requestId.current&&tab==='barcode'){
            const problem=error instanceof ApiError?error:new ApiError('Barcode lookup unavailable. Scan the label or enter this food manually.',503);
            if([404,422,429,503].includes(problem.status)&&onBarcodeError){onBarcodeError(query,problem);return;}
          }
          if(id===requestId.current)throw error;
        }
      });
    }}>
      <div className="search-line">
        <Field
          id="food-search-input"
          name="query"
          key={tab}
          validate={()=>tab==='barcode'&&!/^[0-9]{8,14}$/.test(query)?'Enter an 8–14 digit barcode.':tab==='search'&&(query.trim().length<2||query.trim().length>100)?'Enter 2–100 characters.':undefined}
          inputMode={tab==='barcode'?'numeric':undefined}
          data-modal-autofocus
          label={tab==='barcode'?'Barcode digits':searchLabel}
          hint={tab==='barcode'?'Enter 8–14 digits or tap the camera icon to scan.':undefined}
          required
          value={query}
          onChange={event=>{requestId.current++;setQuery(event.target.value);}}
          insideAction={tab==='barcode'?(
            <Button
              type="button"
              variant="tertiary"
              size="icon"
              className={`barcode-camera-btn ${camera?'active':''}`}
              aria-label={camera?'Stop barcode camera':'Scan barcode with camera'}
              title={camera?'Stop barcode camera':'Scan barcode with camera'}
              onClick={()=>setCamera(value=>!value)}
            >
              <Camera size={18}/>
            </Button>
          ):undefined}
          action={<Button variant="primary" type="submit" disabled={busy}>{busy?'Searching…':'Search'}</Button>}
        />
      </div>
    </Form>

    {tab==='barcode'&&camera&&open&&step==='selection'&&<Modal open={camera} onClose={()=>setCamera(false)} width="sm" title="Scan barcode" closeLabel="Stop barcode camera">
      <div className="barcode-scanner-modal">
        <p className="source">Point your camera at a food barcode to scan it automatically.</p>
        <BarcodeCamera
          onDetected={code=>{
            setCamera(false);
            setQuery(code);
            lookup(code);
          }}
          onError={message=>{
            setError(message);
            setCamera(false);
          }}
        />
      </div>
    </Modal>}

    {results.length>0&&<div className="food-search-results">
      {results.map((result,index)=>{
        const starred=isSaved?isSaved(result):false;
        return <div
          className="food-row interactive"
          key={`${result.source}|${result.name}|${index}`}
          role="button"
          aria-label={result.name}
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
            <small>{nutritionSummary(result,energyUnit)} · {result.source}</small>
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
    </div>}
  </>;
}
