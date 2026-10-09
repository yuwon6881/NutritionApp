import {useEffect,useRef,useState} from 'react';
import {ArrowRight,LoaderCircle} from 'lucide-react';
import {Button} from './ui/Button';
import {Brand} from './ui/Brand';
import {CardFeedback} from './ui/CardFeedback';
import {centralAuthError} from '../lib/centralAuthError';

export function Auth({onLogin:_onLogin,sessionExpired=false}:{onLogin?:(id:string)=>void;sessionExpired?:boolean}){
  const [errorCode]=useState(()=>new URLSearchParams(window.location.search).get('central_error'));
  const [starting,setStarting]=useState(false);
  const navigationStarted=useRef(false);

  useEffect(()=>{
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
          {sessionExpired&&!errorCode&&<CardFeedback
            tone="info"
            title="Session expired"
            message="Sign in again to continue. Changes saved on this device are kept and sync after you sign in."
          />}
          {errorCode&&<CardFeedback
            tone={errorCode==='access_denied'?'info':'error'}
            title={errorCode==='access_denied'?'Sign-in cancelled':'Sign-in could not be completed'}
            message={errorCode==='access_denied'?'You’re still signed out. Sign in again when you’re ready to allow access to Nutrition.':centralAuthError(errorCode)}
          />}
          <Button className="auth-submit" variant="primary" type="button" disabled={starting} aria-busy={starting} onClick={()=>{
            if(navigationStarted.current)return;
            navigationStarted.current=true;
            try{localStorage.removeItem('nutrition-signed-out');}catch{}
            setStarting(true);
            window.setTimeout(()=>window.location.assign('/api/auth/central/start'),120);
          }}>
            <span>{starting?'Opening Fitness Account…':'Sign in with Fitness Account'}</span>
            {starting?<LoaderCircle size={18} className="spin" aria-hidden="true"/>:<ArrowRight size={18}/>}
          </Button>
          <p className="auth-registration">New to Nutrition? You can create an account on the next screen.</p>
        </section>
        <footer className="auth-footer">Food diary <span aria-hidden="true">·</span> Nutrition targets <span aria-hidden="true">·</span> Progress</footer>
      </div>
    </main>
  );
}
