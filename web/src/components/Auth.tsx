import {useEffect,useRef,useState} from 'react';
import {ArrowRight} from 'lucide-react';
import {Button} from './ui/Button';
import {Brand} from './ui/Brand';
import {FatSecretAttribution} from './FatSecretAttribution';
import {centralAuthError} from '../lib/centralAuthError';

export function Auth({onLogin:_onLogin}:{onLogin?:(id:string)=>void}){
  const [error,setError]=useState('');
  const [starting,setStarting]=useState(false);
  const navigationStarted=useRef(false);

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const centralError=params.get('central_error');
    if(centralError)setError(centralAuthError(centralError));
    const restore=()=>{navigationStarted.current=false;setStarting(false);};
    window.addEventListener('pageshow',restore);
    return()=>window.removeEventListener('pageshow',restore);
  },[]);

  return (
    <main className="auth-page">
      <div className="auth-shell">
        <header className="auth-header">
          <div className="brand"><Brand size={32}/> Nutrition</div>
        </header>
        <section className="panel auth-card" aria-labelledby="auth-heading">
          <p className="eyebrow">YOUR FOOD DIARY</p>
          <h1 id="auth-heading">Sign in to Nutrition</h1>
          <p className="auth-description">Use your Fitness Account to access your diary, nutrition targets, and progress.</p>
          {error&&<p className="error" role="alert">{error}</p>}
          <Button className="auth-submit" variant="primary" type="button" disabled={starting} onClick={()=>{
            if(navigationStarted.current)return;
            navigationStarted.current=true;
            try{localStorage.removeItem('nourish-signed-out');}catch{}
            setStarting(true);
            window.setTimeout(()=>window.location.assign('/api/auth/central/start'),120);
          }}>
            {starting?'Opening Fitness Account…':'Sign in with Fitness Account'}{!starting&&<ArrowRight size={18}/>}
          </Button>
          {starting&&<p className="auth-status" role="status">Starting secure sign-in…</p>}
          <p className="auth-registration">New to Nutrition? You can create an account on the next screen.</p>
        </section>
        <footer className="auth-footer">Food diary <span aria-hidden="true">·</span> Nutrition targets <span aria-hidden="true">·</span> Progress <span aria-hidden="true">·</span> <FatSecretAttribution/></footer>
      </div>
    </main>
  );
}
