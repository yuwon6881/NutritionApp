import {useEffect,useState} from 'react';
import {api,ApiError} from '../lib/api';
import {Button} from './ui/Button';
import {CardFeedback} from './ui/CardFeedback';

type Grant={peer:string;status:'active'|'revoked';scopes:string[];grantedAt:string|null;revokedAt:string|null};
export function ConnectedApps(){
  const [grant,setGrant]=useState<Grant>();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [loaded,setLoaded]=useState(false);
  const load=async()=>{
    setLoaded(false);setError('');
    try{const rows=await api<Grant[]>('/integrations/connected');setGrant(rows.find(row=>row.peer==='workout'));}
    catch(ex){setError(ex instanceof ApiError?ex.message:'Connected app status is unavailable.');}
    finally{setLoaded(true);}
  };
  useEffect(()=>{
    void load();
    const url=new URL(window.location.href);
    if(url.searchParams.get('error')==='access_denied'){
      setNotice('Workout connection was canceled.');
      url.searchParams.delete('error');
      window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
    }
  },[]);
  const connect=()=>{
    setBusy(true);setError('');
    // The backend performs the authorization-code exchange and stores only the encrypted
    // rotating refresh token. The PWA never receives either token.
    window.location.href='/api/auth/central/connect';
  };
  const revoke=async()=>{
    setBusy(true);setError('');
    try{await api<void>('/integrations/connected/workout',undefined,'DELETE');setGrant(undefined);}
    catch(ex){setError(ex instanceof ApiError?ex.message:'Could not revoke Workout access.');}
    finally{setBusy(false);}
  };
  return <section className="panel" aria-labelledby="connected-apps-title">
    <h2 id="connected-apps-title">Connected Apps</h2>
    <p>Nutrition reads Workout’s scheduled, in-progress, and completed training summaries. Workout never changes Nutrition targets. To enable the reverse direction, connect Nutrition from Workout.</p>
    <ul className="source-list"><li><code>workout.training_summary.read</code> · Workout → Nutrition</li></ul>
    {!loaded&&!error&&<p className="source" role="status" aria-busy="true">Loading connected app status…</p>}
    {error&&<CardFeedback title="Connected apps unavailable" message={error} action={{label:'Retry',onClick:()=>void load()}}/>}
    {loaded&&!error&&grant?.status==='active'?(
      <div className="connected-app-active">
        <p className="notice">Workout access is granted. Nutrition targets are never changed by training data.</p>
        <div className="actions">
          <Button variant="destructive" disabled={busy} onClick={()=>void revoke()}>Revoke access</Button>
        </div>
      </div>
    ):loaded&&!error?(
      <div className="actions">
        <Button variant="secondary" disabled={busy} onClick={connect}>{busy?'Opening Fitness Account…':'Connect Workout'}</Button>
      </div>
    ):null}
    {notice&&<p className="source" role="status">{notice}</p>}
  </section>;
}
