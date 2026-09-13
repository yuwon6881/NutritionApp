import {useEffect,useRef,useState} from 'react';
import {Camera, Star} from 'lucide-react';
import type {EnergyUnit} from '../types';
import {api} from '../lib/api';
import {number} from '../lib/format';
import {Button} from './ui/Button';
import {Field} from './ui/Field';
import {Form} from './ui/Form';
import {BarcodeCamera} from './BarcodeCamera';
import {displayEnergy,energyLabel} from '../lib/units';

type SearchResult = import('../types').FoodSearchResult;

function nutritionSummary(result:SearchResult,energyUnit:EnergyUnit){
  const serving=result.portions?.[0];
  if(!serving)return `${displayEnergy(result.calories,energyUnit)} ${energyLabel(energyUnit)} / 100 g`;
  const calories=result.servingCalories??result.calories*serving.grams/100;
  const label=/^\d+(?:[.,]\d+)?\s*g$/i.test(serving.label.trim())
    ?`${number(serving.grams,1)} g`
    :`${serving.label} (${number(serving.grams,1)} g)`;
  return `${displayEnergy(calories,energyUnit)} ${energyLabel(energyUnit)} / ${label}`;
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
  useEffect(()=>{requestId.current++;return()=>{requestId.current++;};},[tab,step,open]);
  const lookup=(value:string)=>{
    const id=++requestId.current;
    void run(async()=>{try{const found=tab==='barcode'?[await api<SearchResult>('/foods/barcode/'+encodeURIComponent(value))]:await api<SearchResult[]>('/foods/search?q='+encodeURIComponent(value));if(id===requestId.current)setResults(found);}catch(error){if(id===requestId.current)throw error;}});
  };

  return <>
    <h3>{tab==='barcode'?'Packaged food':'Food search'}</h3>
    <Form onSubmit={event=>{
      event.preventDefault();
      const id=++requestId.current;
      void run(async()=>{try{const found=tab==='barcode'?[await api<SearchResult>('/foods/barcode/'+encodeURIComponent(query))]:await api<SearchResult[]>('/foods/search?q='+encodeURIComponent(query));if(id===requestId.current)setResults(found);}catch(error){if(id===requestId.current)throw error;}});
    }}>
      <div className="search-line">
        <Field
          id="food-search-input"
          name="query"
          key={tab}
          validate={()=>tab==='barcode'&&!/^[0-9]{8,14}$/.test(query)?'Enter an 8–14 digit barcode.':tab==='search'&&(query.trim().length<2||query.trim().length>100)?'Enter 2–100 characters.':undefined}
          inputMode={tab==='barcode'?'numeric':undefined}
          data-modal-autofocus
          label={tab==='barcode'?'Barcode digits':'Search term'}
          required
          value={query}
          onChange={event=>{requestId.current++;setQuery(event.target.value);}}
          action={<Button variant="primary" type="submit" disabled={busy}>{busy?'Searching…':'Search'}</Button>}
        />
      </div>
    </Form>

    {tab==='barcode'&&<>
      <div className="barcode-scan-options">
        <Button variant="primary" onClick={()=>setCamera(value=>!value)}>
          <Camera size={18}/>{camera?'Stop camera':'Scan barcode with camera'}
        </Button>
      </div>
      {camera&&open&&step==='selection'&&<section className="barcode-scanner-step" aria-labelledby="barcode-scanner-title">
        <div className="section-heading"><div><h3 id="barcode-scanner-title">Barcode scanner</h3><p>Scan one item and return to its lookup result.</p></div><Button variant="tertiary" onClick={()=>setCamera(false)}>Done scanning</Button></div>
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
      </section>}
    </>}

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
  </>;
}
