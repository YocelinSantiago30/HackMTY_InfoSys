const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { Client } = require('../backend/node_modules/pg');
require('../backend/node_modules/dotenv').config({ path:path.join(__dirname,'../backend/.env'), quiet:true });
async function main(){
 const url = new URL(process.env.DATABASE_URL);
 if(url.pathname !== '/smartcourier_web')throw Error('Este script solo prepara la base aislada smartcourier_web.');
 url.pathname='/postgres';
 const db=new Client({connectionString:url.toString()});
 await db.connect();
 try{const {rows}=await db.query('SELECT 1 FROM pg_database WHERE datname=$1',['smartcourier_web']);if(!rows.length)await db.query('CREATE DATABASE smartcourier_web');}finally{await db.end();}
 for(const script of ['src/config/migrate.js','src/config/seed.js']){
  const result=spawnSync(process.execPath,[script],{cwd:path.join(__dirname,'../backend'),stdio:'inherit'});
  if(result.status!==0)throw Error(`Falló ${script}`);
 }
 console.log('Base smartcourier_web lista; la base original no fue modificada.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
