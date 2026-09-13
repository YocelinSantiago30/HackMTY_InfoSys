import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { ChartNoAxesCombined, Map, History, Settings, LogOut, Radio, ArrowUpRight, Menu, X, BrainCircuit } from 'lucide-react';
import { lazy, Suspense, useState, useEffect } from 'react';
import { useAuth } from './contexts/AuthContext';
import { useSimulation } from './contexts/SimulationContext';
import { Logo, Loading, Notice } from './components/UI';
import { errorMessage } from './utils/display';
import AuthPage from './pages/AuthPage';
import ComparisonPage from './pages/ComparisonPage';
const MapPage = lazy(() => import('./pages/MapPage'));
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';
import CourierPage from './pages/CourierPage';

const links=[['/courier','Agente Courier',BrainCircuit],['/comparison','Comparación',ChartNoAxesCombined],['/map','Mapa en vivo',Map],['/history','Historial',History],['/settings','Ajustes',Settings]];
function Layout(){
  const {user,logout}=useAuth();const sim=useSimulation();const location=useLocation();
  const [menu,setMenu]=useState(false),[error,setError]=useState('');
  useEffect(()=>{window.scrollTo({top:0,left:0,behavior:'instant'});},[location.pathname]);
  const title=links.find(([path])=>location.pathname===path)?.[1]||'Centro de operaciones';
  async function leave(){try{sim.reset();await logout();}catch(e){setError(errorMessage(e));}}
  return <div className="app-shell">
    <a className="skip-link" href="#main">Ir al contenido</a>
    {menu&&<button className="nav-backdrop" onClick={()=>setMenu(false)} aria-label="Cerrar navegación"/>}
    <aside className={`sidebar ${menu?'open':''}`}><NavLink to="/comparison" className="brand-link" onClick={()=>setMenu(false)}><Logo/></NavLink><button className="mobile-close icon-button" onClick={()=>setMenu(false)} aria-label="Cerrar menú"><X/></button>
      <p className="nav-label">CENTRO DE OPERACIONES</p><nav>{links.map(([to,label,Icon])=><NavLink to={to} key={to} onClick={()=>setMenu(false)}><Icon size={19}/><span>{label}</span>{to==='/comparison'&&<span className="nav-dot"/>}</NavLink>)}</nav>
      <div className="sidebar-note"><span className="note-icon"><Radio size={18}/></span><strong>Dos estrategias.<br/>Un mismo turno.</strong><p>Compara cada decisión con las mismas condiciones de reparto.</p><NavLink to="/comparison">Ver simulación <ArrowUpRight size={15}/></NavLink></div>
      <div className="sidebar-bottom"><div className="avatar">{user.name?.slice(0,1).toUpperCase()}</div><div><strong>{user.name}</strong><small>Cuenta de repartidor</small></div><button className="icon-button" onClick={leave} aria-label="Cerrar sesión" title="Cerrar sesión"><LogOut size={18}/></button></div>
    </aside>
    <div className="workspace"><header className="topbar"><div><button className="mobile-toggle icon-button" onClick={()=>setMenu(true)} aria-label="Abrir menú"><Menu/></button><span className="breadcrumb">Operaciones <span>/</span> <b>{title}</b></span></div><div className="topbar-right"><span className="location-label">Monterrey, NL</span><span className={`connection ${sim.connection==='connected'?'online':''}`}><i/>{sim.connection==='connected'?'En tiempo real':sim.connection==='reconnecting'?'Reconectando':sim.connection==='connecting'?'Conectando':'Sin turno activo'}</span></div></header>
      <main id="main" tabIndex={-1}><Notice>{error}</Notice><Outlet/></main><footer className="app-footer"><span>SmartCourier AI</span><span>Decisiones explicables · Resultados del simulador</span></footer>
    </div>
  </div>;
}
function Protected(){const {user,isLoading}=useAuth();if(isLoading)return <div className="full-loading"><Loading>Restaurando tu sesión...</Loading></div>;return user?<Layout/>:<Navigate to="/login" replace/>;}
function Guest(){const {user,isLoading}=useAuth();if(isLoading)return <Loading/>;return user?<Navigate to="/comparison" replace/>:<Outlet/>;}
export default function App(){return <Routes><Route element={<Guest/>}><Route path="/login" element={<AuthPage/>}/><Route path="/register" element={<AuthPage register/>}/></Route><Route element={<Protected/>}><Route path="/comparison" element={<ComparisonPage/>}/><Route path="/map" element={<Suspense fallback={<Loading>Cargando mapa...</Loading>}><MapPage/></Suspense>}/><Route path="/courier" element={<CourierPage/>}/><Route path="/history" element={<HistoryPage/>}/><Route path="/settings" element={<SettingsPage/>}/></Route><Route path="*" element={<Navigate to="/comparison" replace/>}/></Routes>;}
