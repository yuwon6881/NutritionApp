import {useEffect,useState} from 'react';
import {ArrowRight} from 'lucide-react';
import {Button} from './ui/Button';
import {Brand} from './ui/Brand';
import {centralAuthError} from '../lib/centralAuthError';

export function Auth({onLogin:_onLogin}:{onLogin?:(id:string)=>void}){
  const [error,setError]=useState('');

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const centralError=params.get('central_error');
    if(centralError)setError(centralAuthError(centralError));
  },[]);

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <div className="brand"><Brand size={34}/> Nutrition App</div>
        <h1>Nutrition diary</h1>
      </section>
      <section className="auth-panel">
        <h2>Sign in</h2>
        <p className="source">Sign in with your Fitness Account to access your diary.</p>
        {error&&<p className="error" role="alert">{error}</p>}
        <Button variant="primary" type="button" onClick={()=>{
          try{localStorage.removeItem('nourish-signed-out');}catch{}
          window.location.href='/api/auth/central/start';
        }}>
          Sign in with Fitness Account<ArrowRight size={18}/>
        </Button>
        <footer className="auth-footer">
          <a href="/privacy">Privacy</a>
          <span aria-hidden="true">·</span>
          <a href="/terms">Terms</a>
          <span aria-hidden="true">·</span>
          <a href="/help/google-health">Google Health help</a>
        </footer>
      </section>
    </main>
  );
}
