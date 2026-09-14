import {Form} from './ui/Form';
import {useEffect,useState} from 'react';
import {ArrowRight} from 'lucide-react';
import {api} from '../lib/api';
import {Button} from './ui/Button';
import {Brand} from './ui/Brand';
import {Field} from './ui/Field';
import {useAsyncAction} from './ui/useAsyncAction';

export function Auth({onLogin}:{onLogin:(id:string)=>void}){
  const [register,setRegister]=useState(false);const [open,setOpen]=useState(false);const [username,setUsername]=useState('');const [password,setPassword]=useState('');const [error,setError]=useState('');
  const {busy,run}=useAsyncAction();
  useEffect(()=>{void api<{registrationOpen:boolean}>('/auth/status').then(s=>setOpen(s.registrationOpen)).catch(()=>setError('Connect to the service to sign in.'));},[]);

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <div className="brand"><Brand size={34}/> Nutrition App</div>
        <h1>Nutrition diary</h1>
      </section>
      <section className="auth-panel">
        <h2>{register?'Create account':'Sign in'}</h2>
        <Form key={register?'register':'login'} onSubmit={async e=>{e.preventDefault();if(busy)return;setError('');try{await run(async()=>{const user=await api<{id:string}>('/auth/'+(register?'register':'login'),{username,password});localStorage.setItem('nourish-account',user.id);onLogin(user.id);});}catch(ex){setError((ex as Error).message);}}}>
          <Field id="auth-username" name="username" validate={()=>register&&!/^[a-zA-Z0-9._@-]{3,80}$/.test(username.trim())?'Use 3–80 letters, digits, or . _ - @.':error==='Username is unavailable.'?error:undefined} label="Username" autoComplete="username" required value={username} onChange={e=>{setUsername(e.target.value);setError('');}}/>
          <Field id="auth-password" name="password" label="Password" type="password" autoComplete={register?'new-password':'current-password'} minLength={register?12:undefined} maxLength={256} required value={password} onChange={e=>setPassword(e.target.value)}/>
          {error&&error!=='Username is unavailable.'&&<p className="error" role="alert">{error}</p>}
          <Button variant="primary" disabled={busy} type="submit">{busy?'Connecting…':register?'Create account':'Sign in'}<ArrowRight size={18}/></Button>
        </Form>
        {open&&<Button variant="tertiary" onClick={()=>setRegister(!register)}>{register?'Already have an account? Sign in':'New here? Create an account'}</Button>}
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
