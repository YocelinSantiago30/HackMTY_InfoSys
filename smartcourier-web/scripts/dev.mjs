import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
require('../backend/node_modules/dotenv').config({path:path.join(root,'backend/.env'),quiet:true});
const python=process.env.SMARTCOURIER_PYTHON||path.join(root,'optimization-service/venv/bin/python');
if(!fs.existsSync(python)){console.error('Prepara optimization-service/venv siguiendo README_WEB.md antes de iniciar.');process.exit(1);}
const children=[];let stopping=false;
function stop(){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');}
function start(command,args,cwd){const child=spawn(command,args,{cwd:path.join(root,cwd),env:process.env,stdio:'inherit'});children.push(child);child.on('error',e=>{console.error(e.message);stop();process.exitCode=1;});child.on('exit',code=>{if(!stopping){stop();process.exitCode=code||0;}});}
start(python,['-m','uvicorn','main:app','--host','127.0.0.1','--port','8001'],'optimization-service');
start(process.execPath,['src/server.js'],'backend');
start(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1'],'frontend');
process.on('SIGINT',stop);process.on('SIGTERM',stop);
console.log('Web http://localhost:5173 · API http://localhost:5002 · Modelo http://localhost:8001');
