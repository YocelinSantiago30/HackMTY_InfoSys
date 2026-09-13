import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, MapPinned, ShieldCheck, TrendingUp, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Logo, Notice, Field } from '../components/UI';
import { errorMessage } from '../utils/display';

export default function AuthPage({register=false}){
  const auth=useAuth();const [name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(e){e.preventDefault();setBusy(true);setError('');try{register?await auth.register(name.trim(),email.trim(),password):await auth.login(email.trim(),password);}catch(err){setError(errorMessage(err));}finally{setBusy(false);}}
  return <div className="auth-layout"><section className="auth-story"><Logo/><div className="auth-story-content"><span className="eyebrow">DISEÑADO PARA REPARTIR MEJOR</span><h1>Cada decisión<br/>cuenta.</h1><p>Entiende qué pedidos convienen.<br/>Convierte tu tiempo en mejores resultados.</p><div className="auth-route"><div className="route-node">P</div><div className="route-track"><span/></div><div className="route-node destination">D</div></div><ul><li><TrendingUp/>Compara la ganancia real de cada estrategia</li><li><MapPinned/>Sigue las rutas y entregas en tiempo real</li><li><ShieldCheck/>Conoce el motivo detrás de cada decisión</li></ul></div><small>Monterrey, México · SmartCourier AI</small></section>
    <section className="auth-form-side"><div className="auth-form-wrap"><p className="eyebrow">TU CENTRO DE OPERACIONES</p><h2>{register?'Comienza tu recorrido':'Bienvenido de nuevo'}</h2><p className="subtitle">{register?'Crea tu cuenta para explorar las estrategias de reparto.':'Inicia sesión para continuar con tus simulaciones.'}</p><Notice>{error}</Notice><form onSubmit={submit}>
      {register&&<Field label="Nombre" value={name} onChange={e=>setName(e.target.value)} autoComplete="name" placeholder="Tu nombre" required/>}
      <Field label="Correo electrónico" type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" placeholder="nombre@correo.com" required/>
      <Field label="Contraseña" id="auth-password"><span className="password-field"><input id="auth-password" type={visible?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} autoComplete={register?'new-password':'current-password'} minLength={register?6:undefined} placeholder="Tu contraseña" required/><button type="button" className="icon-button" onClick={()=>setVisible(!visible)} aria-label={visible?'Ocultar contraseña':'Mostrar contraseña'}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button></span></Field>
      <button className="button primary full" disabled={busy}>{busy?'Conectando...':register?'Crear cuenta':'Iniciar sesión'}<ArrowRight size={17}/></button>
    </form><p className="auth-switch">{register?'¿Ya tienes una cuenta?':'¿Primera vez aquí?'} <Link to={register?'/login':'/register'} onClick={()=>setError('')}>{register?'Inicia sesión':'Crea tu cuenta'}</Link></p><div className="auth-disclaimer"><ShieldCheck size={16}/><span>Simulación y análisis. Tú tienes el control.</span></div></div></section></div>;
}
