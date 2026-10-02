import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {Camera, LoaderCircle, ScanBarcode, Star} from 'lucide-react';
import type {EnergyUnit} from '../types';
import {api,ApiError} from '../lib/api';
import {number} from '../lib/format';
import {Button} from './ui/Button';
import {Field} from './ui/Field';
import {Form} from './ui/Form';
import {BarcodeCamera} from './BarcodeCamera';
import {Modal} from './ui/Modal';
import {displayEnergy,energyLabel} from '../lib/units';
import {useSearchAsYouType,type SearchCache} from './useSearchAsYouType';
import {nativeBarcodeScannerAvailable} from '../lib/barcode/nativeScanner';
import {NativeBarcodeScanner} from './NativeBarcodeScanner';
import {FatSecretAttribution} from './FatSecretAttribution';
import {isFatSecretSource} from '../lib/foodSources';

type SearchResult = import('../types').FoodSearchResult;

export function nutritionSummary(result:SearchResult,energyUnit:EnergyUnit='kcal'){
  const serving=result.portions?.[0];
  if(serving){
    const calories=result.servingCalories??result.calories*serving.grams/100;
    const trimmed=serving.label.trim();
    // "1 Bottle (330 g)" already states its weight; repeating it would read "(330 g) (330 g)".
    const label=/^\d+(?:[.,]\d+)?\s*g$/i.test(trimmed)
      ?`${number(serving.grams,1)} g`
      :/\d\s*g\b/i.test(trimmed)?trimmed:`${trimmed} (${number(serving.grams,1)} g)`;
    return `${displayEnergy(calories,energyUnit)} ${energyLabel(energyUnit)} / ${label}`;
  }
  if(result.basis==='per100g'){
    return `${displayEnergy(result.calories,energyUnit)} ${energyLabel(energyUnit)} / 100 g`;
  }
  // Open Food Facts' search index can label serving values as per 100 g; the product is
  // looked up when chosen, and only then are its nutrients known to be per 100 g.
  return 'Nutrition loads when opened';
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
  /** Search answers kept by the dialog, so coming back from a review spends no new call. */
  searchCache?:SearchCache;
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
  searchCache,
}:FoodPickerProps){
  const requestId=useRef(0);
  useEffect(()=>{requestId.current++;return()=>{requestId.current++;};},[tab,step,open]);
  const {search,searching:typeaheadSearching}=useSearchAsYouType({
    enabled:tab==='search'&&open&&step==='selection',
    query,
    onResults:found=>{setError('');setResults(found);},
    onError:setError,
    cache:searchCache,
  });
  // The Android app scans with ML Kit behind its own viewfinder; the in-page camera remains the fallback.
  const [scanner,setScanner]=useState<'checking'|'native'|'in-page'>('checking');
  useEffect(()=>{
    let active=true;
    void nativeBarcodeScannerAvailable().then(available=>{if(active)setScanner(available?'native':'in-page');});
    return()=>{active=false;};
  },[]);
  // Typing and the keyboard's search key both search, so either one shows the same indicator.
  const searching=tab==='search'&&(typeaheadSearching||busy);
  const scanning=tab==='barcode'&&camera&&open&&step==='selection';
  const detected=(code:string)=>{
    setCamera(false);
    setQuery(code);
    lookup(code);
  };
  const cameraFailed=(message:string)=>{
    setError(message);
    setCamera(false);
  };
  const resolve=async(value:string)=>{
    if(tab==='search')return search(value);
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
    {/* The method tab already names this panel; the heading remains for screen-reader structure. */}
    <h3 className="food-search-heading sr-only">{tab==='barcode'?'Packaged food':'Food search'}</h3>
    {tab==='barcode'&&<div className="barcode-scan-hero">
      <span className="barcode-scan-hero-icon" aria-hidden="true"><ScanBarcode size={28}/></span>
      <div className="barcode-scan-hero-text">
        <strong>Scan a barcode or QR code</strong>
        <small>Or type the digits below.</small>
      </div>
      <Button type="button" variant="primary" className="barcode-scan-hero-action" aria-label={camera?'Stop barcode camera':'Scan barcode with camera'} onClick={()=>setCamera(value=>!value)}>
        <Camera size={18} aria-hidden="true"/>{camera?'Stop':'Scan barcode'}
      </Button>
    </div>}
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
          enterKeyHint="search"
          data-modal-autofocus
          autoComplete="off"
          label={tab==='barcode'?'Barcode digits':searchLabel}
          hint={tab==='barcode'?'Enter 8–14 digits or scan with the camera.':undefined}
          required
          value={query}
          onChange={event=>{requestId.current++;setQuery(event.target.value);}}
          insideAction={searching?(
            <span className="food-search-spinner" role="status" aria-label="Searching">
              <LoaderCircle size={18} aria-hidden="true"/>
            </span>
          ):tab==='barcode'?(
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
          // Text search runs as the person types (and on the keyboard's search key); barcode
          // digits are looked up only when asked, because a partial code is never a product.
          action={tab==='barcode'?<Button variant="primary" type="submit" disabled={busy}>{busy?'Searching…':'Search'}</Button>:undefined}
        />
      </div>
    </Form>

    {scanning&&scanner==='native'&&<NativeBarcodeScanner
      onDetected={detected}
      onClose={()=>setCamera(false)}
      onUnavailable={()=>setScanner('in-page')}
      onError={cameraFailed}
    />}
    {scanning&&scanner==='in-page'&&<Modal open={camera} onClose={()=>setCamera(false)} width="sm" title="Scan barcode" closeLabel="Stop barcode camera">
      <div className="barcode-scanner-modal">
        <p className="source">Point your camera at a food barcode or product QR code to scan it automatically.</p>
        <BarcodeCamera onDetected={detected} onError={cameraFailed}/>
      </div>
    </Modal>}

    {results.length>0&&<div className="food-search-results">
      {results.map((result,index)=>{
        const starred=isSaved?isSaved(result):false;
        return <div
          className="food-row interactive"
          style={{'--i':Math.min(index,8)} as CSSProperties}
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
    {results.some(result=>isFatSecretSource(result.source))&&<p className="source food-search-attribution"><FatSecretAttribution/></p>}
  </>;
}
