import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const entry=path.join(root,'scripts/dev.mjs');
const directory=path.join(root,'.runtime');
const pidFile=path.join(directory,'local.json');
let pid;
try{
 const saved=JSON.parse(fs.readFileSync(pidFile,'utf8'));
 const command=execFileSync('ps',['-p',String(saved.pid),'-o','args='],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 if(command.endsWith(entry))pid=saved.pid;
}catch{}
const action=process.argv[2]||'status';
if(action==='start'){
 if(pid){console.log(`Ya está corriendo (PID ${pid}): http://127.0.0.1:5173`);}
 else{
  fs.mkdirSync(directory,{recursive:true});
  const log=fs.openSync(path.join(directory,'server.log'),'a');
  const child=spawn(process.execPath,[entry],{cwd:root,detached:true,stdio:['ignore',log,log]});
  child.unref();fs.closeSync(log);
  fs.writeFileSync(pidFile,JSON.stringify({pid:child.pid,startedAt:new Date().toISOString()})+'\n');
  console.log(`Iniciando web, API y modelo (PID ${child.pid}): http://127.0.0.1:5173\nLog: ${directory}/server.log`);
 }
}else if(action==='stop'){
 if(pid){process.kill(pid,'SIGTERM');console.log('Deteniendo los tres servicios de la copia web.');}
 else console.log('La copia web no está corriendo con este lanzador.');
}else if(action==='status'){
 console.log(pid?`Lanzador activo (PID ${pid}).`:'Lanzador detenido.');
 if(pid){
  const results=await Promise.allSettled(['http://127.0.0.1:5173','http://127.0.0.1:5002/api/health','http://127.0.0.1:8001/health'].map(async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(3000)});if(!response.ok)throw Error(`${url}: ${response.status}`);return `${url}: OK`;}));
  for(const r of results){console.log(r.status==='fulfilled'?r.value:String(r.reason));if(r.status==='rejected')process.exitCode=1;}
 }
}else{console.error('Usa start, stop o status');process.exitCode=1;}
