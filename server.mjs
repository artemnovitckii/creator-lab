import http from 'node:http';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';
import {Pipeline} from './lib/pipeline.mjs';
import {dimensions,roles,VERSION} from './lib/schema.mjs';
import {metrics} from './lib/data.mjs';
import {checkProvider,download} from './lib/providers.mjs';
import {demo,artwork} from './lib/demo.mjs';
const ROOT=dirname(fileURLToPath(import.meta.url));
const PORT=Number(process.env.PORT||5190),HOST='127.0.0.1';
const CSRF=randomBytes(32).toString('hex');
let localEnv={};try{localEnv=parseEnv(await readFile(join(ROOT,'.env'),'utf8'));}catch{}
const transcriptionProvider=localEnv.TRANSCRIPTION_PROVIDER||process.env.TRANSCRIPTION_PROVIDER||'fireworks';
const sessionKeys={};const verified={};
const keys=()=>({openai:sessionKeys.openai||localEnv.OPENAI_API_KEY||process.env.OPENAI_API_KEY,fireworks:sessionKeys.fireworks||localEnv.FIREWORKS_API_KEY||process.env.FIREWORKS_API_KEY,apify:sessionKeys.apify||localEnv.APIFY_TOKEN||process.env.APIFY_TOKEN||process.env.APIFY_API_TOKEN,groq:sessionKeys.groq||localEnv.GROQ_API_KEY||process.env.GROQ_API_KEY,jev:sessionKeys.jev||localEnv.TYPESAFE_API_KEY||process.env.TYPESAFE_API_KEY||process.env.JEV_API_KEY});
const pipeline=await new Pipeline(process.env.LAB_DATA_DIR||join(ROOT,'data'),keys,{transcriptionProvider,fireworksRpm:Number(localEnv.FIREWORKS_REQUESTS_PER_MINUTE||process.env.FIREWORKS_REQUESTS_PER_MINUTE||60),groqRpm:Number(localEnv.GROQ_REQUESTS_PER_MINUTE||process.env.GROQ_REQUESTS_PER_MINUTE||20),openaiRpm:Number(localEnv.OPENAI_REQUESTS_PER_MINUTE||process.env.OPENAI_REQUESTS_PER_MINUTE||60)}).init();
let mediaActive=0;const mediaWaiters=[],mediaPending=new Map();async function mediaTask(fn){if(mediaActive>=8)await new Promise(resolve=>mediaWaiters.push(resolve));else mediaActive++;try{return await fn();}finally{if(mediaWaiters.length)mediaWaiters.shift()();else mediaActive--;}}
const clients=new Set();pipeline.listeners.add(id=>{for(const res of clients)res.write(`data: ${JSON.stringify({id})}\n\n`);});
const publicJob=j=>{const copy=structuredClone(j);for(const p of copy.posts){if(p.transcript)delete p.transcript.raw;if(p.analysis)delete p.analysis.raw;}return copy;};
const summary=j=>({id:j.id,creator:j.creator,status:j.status,createdAt:j.createdAt,count:j.posts.length,completed:j.posts.filter(p=>p.analysis).length});
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>20*1024*1024)throw new Error('Request exceeds 20 MB');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
const streams=setInterval(()=>{for(const res of clients)res.write(': heartbeat\n\n');},20000);streams.unref();
const server=http.createServer(async(req,res)=>{
 try{
  if(![`127.0.0.1:${PORT}`,`localhost:${PORT}`].includes(req.headers.host)){json(res,403,{error:'Local requests only'});return;}
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  const url=new URL(req.url,`http://${HOST}:${PORT}`);const path=url.pathname;
  if(req.method!=='GET'&&(req.headers['x-lab-token']!==CSRF||req.headers.origin&&![`http://${HOST}:${PORT}`,`http://localhost:${PORT}`].includes(req.headers.origin))){json(res,403,{error:'Refresh the local app before changing data'});return;}
  if(path==='/api/bootstrap'){json(res,200,{token:CSRF,transcriptionProvider,dimensions:Object.fromEntries(Object.entries(dimensions).map(([k,v])=>[k,{title:v.title,criteria:v.question.criteria}])),roles,version:VERSION,connections:Object.fromEntries(Object.entries(keys()).map(([k,v])=>[k,{configured:Boolean(v),verified:verified[k]||false}])),runs:[...pipeline.jobs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(summary)});return;}
  if(path==='/api/connections'&&req.method==='POST'){const data=await body(req);for(const name of ['apify','groq','fireworks','openai','jev'])if(typeof data[name]==='string'&&data[name].trim()){sessionKeys[name]=data[name].trim();verified[name]=false;}json(res,200,{saved:true});return;}
  if(path==='/api/connections/check'&&req.method==='POST'){const results=Object.fromEntries(await Promise.all(Object.entries(keys()).map(async([name,key])=>[name,await checkProvider(name,key)])));for(const [name,r]of Object.entries(results))verified[name]=r.verified;json(res,200,results);return;}
  if(path==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});res.write(': connected\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;}
  if(path==='/api/demo'){json(res,200,demo());return;}
  if(path==='/api/runs'&&req.method==='POST'){const data=await body(req);const job=await pipeline.create(data,data.rows);json(res,201,publicJob(job));return;}
  const match=path.match(/^\/api\/runs\/([\w-]+)(?:\/(run|pause|export|metrics|attach))?$/);
  if(match){const [,id,action]=match;const job=pipeline.jobs.get(id);if(!job){json(res,404,{error:'Run not found'});return;}
   if(action==='run'&&req.method==='POST'){if(pipeline.active.size&&!pipeline.active.has(id))throw new Error('Pause the current run first');const settings=await body(req);if(settings.concurrency!==undefined){const n=Number(settings.concurrency);if(!Number.isInteger(n)||n<1||n>12)throw new Error('Concurrency must be 1 to 12');job.concurrency=n;}await pipeline.run(id);json(res,200,publicJob(job));return;}
   if(action==='pause'&&req.method==='POST'){await pipeline.pause(id);json(res,200,{paused:true});return;}
   if(action==='attach'&&req.method==='POST'){await pipeline.attachScrape(id,(await body(req)).runId);json(res,200,{attached:true});return;}
   if(action==='metrics'){json(res,200,metrics(job.posts,{dimension:url.searchParams.get('dimension')||'mechanism',metric:url.searchParams.get('metric')||'views',minAgeDays:Number(url.searchParams.get('minAgeDays')??7)}));return;}
   if(action==='export'){res.setHeader('Content-Disposition',`attachment; filename="${job.creator}-${id}.json"`);json(res,200,publicJob(job));return;}
   json(res,200,publicJob(job));return;
  }
  const art=path.match(/^\/demo-art\/(\d+)\.svg$/);if(art){res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'public, max-age=86400'});res.end(artwork(Number(art[1])));return;}
  const thumb=path.match(/^\/media\/([\w-]+)\/([\w-]+)$/);if(thumb){const job=pipeline.jobs.get(thumb[1]),post=job?.posts.find(p=>p.id===thumb[2]);if(!post?.thumbnailUrl){res.writeHead(404);res.end();return;}const file=join(pipeline.root,'media',post.id+'.img');let bytes;try{bytes=await readFile(file);}catch{if(!mediaPending.has(file))mediaPending.set(file,mediaTask(async()=>{const result=await download(post.thumbnailUrl,8*1024*1024);if(!/^image\/(jpeg|png|webp)/.test(result.type))throw new Error('Unsupported thumbnail format');await writeFile(file,result.bytes);return result.bytes;}).finally(()=>mediaPending.delete(file)));bytes=await mediaPending.get(file);}const type=bytes[0]===0x89?'image/png':bytes.toString('ascii',8,12)==='WEBP'?'image/webp':'image/jpeg';res.writeHead(200,{'Content-Type':type,'Cache-Control':'public, max-age=86400'});res.end(bytes);return;}
  const files={'/record':'record.html','/record.js':'record.js','/record.css':'record.css','/':'index.html','/app.js':'app.js','/research.mjs':'research.mjs','/styles.css':'styles.css'};
  if(files[path]){const file=join(ROOT,'public',files[path]);const content=await readFile(file);res.writeHead(200,{'Content-Type':path.endsWith('.css')?'text/css':path.endsWith('.js')||path.endsWith('.mjs')?'text/javascript':'text/html','Cache-Control':'no-cache'});res.end(content);return;}
  json(res,404,{error:'Not found'});
 }catch(e){json(res,400,{error:e.message||'Request failed'});}
});
server.listen(PORT,HOST,()=>console.log(`Creator Lab ready at http://${HOST}:${PORT}`));
