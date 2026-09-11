import {useState} from 'react';
import {Camera, Star} from 'lucide-react';
import type {EnergyUnit,Nutrients} from '../types';
import {api} from '../lib/api';
import {outstanding,etaSeconds,waitMs} from '../lib/scanQueue';
import type {FoodBasketHook} from '../useFoodBasket';
import {Button} from './ui/Button';
import {Field} from './ui/Field';
import {Form} from './ui/Form';
import {SegmentedControl} from './ui/SegmentedControl';
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
  basket:FoodBasketHook;
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
  basket,
  onChoose,
  onSaveFood: _onSaveFood,
  isSaved,
  onToggleSave,
  run,
  open,
  step,
  energyUnit='kcal',
}:FoodPickerProps){
  const [scanMode,setScanMode]=useState<'single'|'multiple'>('single');
  const pendingCount=outstanding(basket.queue);
  const eta=etaSeconds(pendingCount,waitMs(basket.queue,Date.now()));

  return <>
    <h3>{tab==='barcode'?'Packaged food':'Food search'}</h3>
    <Form onSubmit={event=>{
      event.preventDefault();
      void run(async()=>setResults(tab==='barcode'
        ?[await api<SearchResult>('/foods/barcode/'+encodeURIComponent(query))]
        :await api<SearchResult[]>('/foods/search?q='+encodeURIComponent(query))
      ));
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
          onChange={event=>setQuery(event.target.value)}
          action={<Button variant="primary" type="submit" disabled={busy}>{busy?'Searching…':'Search'}</Button>}
        />
      </div>
    </Form>

    {tab==='barcode'&&<>
      <div className="barcode-scan-options">
        <Button onClick={()=>setCamera(value=>!value)}>
          <Camera size={18}/>{camera?'Stop camera':'Scan barcode with camera'}
        </Button>
        <div className="barcode-scan-mode-copy">
          <strong>Scan mode</strong>
          <small>Choose whether the camera stops after one barcode or keeps adding items to the batch.</small>
        </div>
        <SegmentedControl
          className="barcode-scan-mode"
          label="Barcode scan mode"
          value={scanMode}
          onChange={setScanMode}
          options={[
            {value:'single',label:'One barcode',ariaLabel:'Scan one barcode'},
            {value:'multiple',label:'Multiple barcodes',ariaLabel:'Scan multiple barcodes'},
          ]}
        />
      </div>
      {camera&&open&&step==='selection'&&<BarcodeCamera
        continuous={scanMode==='multiple'}
        onDetected={code=>{
          if(scanMode==='multiple'){
            basket.enqueueCode(code);
          }else{
            setQuery(code);
            setCamera(false);
          }
        }}
        onError={message=>{
          setError(message);
          setCamera(false);
        }}
      />}
      {basket.queue.items.length>0&&<div className="scan-queue" style={{margin:'14px 0'}}>
        {pendingCount>0&&<p className="notice" role="status">
          Resolving {pendingCount} {pendingCount===1?'barcode lookup':'barcode lookups'} (about {eta} s)…
        </p>}
        <div className="queue-list" style={{display:'grid',gap:6}}>
          {basket.queue.items.map(item=><div
            key={item.code}
            className="queue-item"
            style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:'.8rem',padding:'6px 0',borderBottom:'1px solid var(--border)'}}
          >
            <span><strong>{item.code}</strong>{item.name?` · ${item.name}`:''}</span>
            <small style={{color:item.status==='failed'||item.status==='not-found'||item.status==='no-calories'?'var(--destructive)':'var(--muted-foreground)'}}>
              {item.status==='added'?'Added to batch':
               item.status==='looking-up'?'Looking up…':
               item.status==='rate-limited'?item.message??'Rate limited. Retrying…':
               item.status==='queued'?'Queued':
               item.message??item.status}
            </small>
          </div>)}
        </div>
      </div>}
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

