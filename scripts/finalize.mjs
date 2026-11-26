import {readFile,writeFile,readdir,stat} from 'node:fs/promises';
const file='dist/client/index.html';let html=await readFile(file,'utf8');
html=html.replace(/<script type="module" crossorigin src=/g,'<script defer src=');
await writeFile(file,html);
if(/<script(?![^>]*src=)[^>]*>\s*\S/.test(html))throw Error('inline script in production HTML');
const sizes=[];async function scan(dir){for(const name of await readdir(dir)){const path=dir+'/'+name,s=await stat(path);if(s.isDirectory())await scan(path);else sizes.push({path,bytes:s.size})}}await scan('dist/client');
console.log('self-contained browser payload:',sizes.reduce((n,s)=>n+s.bytes,0),'bytes');
