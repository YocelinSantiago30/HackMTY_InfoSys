import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(path.join(root,'COPY_MANIFEST.json'),'utf8'));
const amendments=JSON.parse(await readFile(path.join(root,'COPY_AMENDMENTS.json'),'utf8')).files;
const changed=[];
for(const [name,expected] of Object.entries(manifest.preserved_files)){
 const actual=createHash('sha256').update(await readFile(path.join(root,name))).digest('hex');
 if(actual!==(amendments[name]?.sha256||expected))changed.push(name);
}
if(changed.length){console.error('Cambios sin registrar respecto de la copia y sus correcciones:',changed);process.exitCode=1;}
else console.log(`${Object.keys(manifest.preserved_files).length} archivos verificados: ${Object.keys(amendments).length} cambios registrados en COPY_AMENDMENTS.json; los demás idénticos a la copia inicial.`);
