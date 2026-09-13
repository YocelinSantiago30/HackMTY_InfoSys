import { AlertCircle, CheckCircle2, LoaderCircle, Package, XCircle, Clock3, Layers3 } from 'lucide-react';
import { cloneElement, useId } from 'react';
export function Logo(){return <span className="brand"><span className="brand-mark"><Package size={24}/></span><span>SmartCourier <em>AI</em><small>INTELIGENCIA EN CADA ENTREGA</small></span></span>;}
export function Loading({children='Cargando...'}){return <div className="loading" role="status"><LoaderCircle className="spin" size={22}/>{children}</div>;}
export function Notice({children,success=false}){return children?<div className={`notice ${success?'success':''}`} role={success?'status':'alert'}>{success?<CheckCircle2 size={18}/>:<AlertCircle size={18}/>}<span>{children}</span></div>:null;}
export function Empty({title,children,icon:Icon=Package}){return <div className="empty"><span className="empty-icon"><Icon size={27}/></span><h3>{title}</h3><p>{children}</p></div>;}
const decisions={ACCEPT:['Aceptado',CheckCircle2],REJECT:['Rechazado',XCircle],SKIP:['Descartado',XCircle],WAIT:['Esperar',Clock3],BATCH:['Agrupado',Layers3],REPOSITION:['Reposicionar',Package],REROUTE:['Nueva ruta',Package]};
export function Badge({decision}){const [label,Icon]=decisions[decision]||['Evaluando',Clock3];return <span className={`badge ${decision||'PENDING'}`} title={decision}><Icon size={13}/>{label}</span>;}
export function Field({label,children,...props}){const generatedId=useId();const id=props.id||children?.props?.id||generatedId;return <div className="field"><label htmlFor={id}>{label}</label>{children?(['input','select','textarea'].includes(children.type)?cloneElement(children,{id}):children):<input {...props} id={id}/>}</div>;}
export function PageHeading({eyebrow,title,children,action}){return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{children&&<p className="subtitle">{children}</p>}</div>{action}</div>;}
