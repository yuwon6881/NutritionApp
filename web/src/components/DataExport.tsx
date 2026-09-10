import {useState} from 'react';
import type {Nourish} from '../useNourish';
import {downloadApi} from '../lib/download';
import {Button} from './ui/Button';
import {useAsyncAction} from './ui/useAsyncAction';

export function DataExport({store}:{store:Nourish}){
  const [error,setError]=useState('');
  const {busy,run}=useAsyncAction();
  const detailDays=store.state?.detailDays??90;
  const download=async(path:string,filename:string)=>{
    setError('');
    try{await run(()=>downloadApi(path,filename));}
    catch(ex){setError((ex as Error).message);}
  };

  return <section className="panel" aria-labelledby="data-export-title">
    <h2 id="data-export-title">Export your data</h2>
    <p>Download the account records currently retained by NutritionApp. Meal detail is retained for the latest {detailDays} days; archived daily totals remain available after detail cleanup.</p>
    <div className="actions">
      <Button type="button" disabled={busy} onClick={()=>void download('/export','nutrition-export.json')}>{busy?'Preparing…':'Download JSON'}</Button>
      <Button type="button" variant="secondary" disabled={busy} onClick={()=>void download('/export/csv','nutrition-export-csv.zip')}>{busy?'Preparing…':'Download CSV ZIP'}</Button>
    </div>
    {error&&<p className="error" role="alert">{error}</p>}
  </section>;
}
