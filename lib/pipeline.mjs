import {mkdir,readFile,writeFile,rename,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {deduplicate,fingerprint} from './data.mjs';
import {cacheKey,VERSION} from './schema.mjs';
import * as providers from './providers.mjs';
export async function atomic(path,value){const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,2),{mode:0o600});await rename(temp,path);}
export class Pipeline{
 constructor(root,keys,{groqRpm=20,transcriptionProvider='groq',fireworksRpm=60,openaiRpm=60}={}){this.root=root;this.keys=keys;this.jobs=new Map();this.active=new Set();this.listeners=new Set();this.writes=new Map();if(!providers.transcriptionProviders[transcriptionProvider])throw new Error('Unsupported transcription provider');this.transcriptionProvider=transcriptionProvider;this.fireworksRpm=fireworksRpm;this.fireworksPacer=providers.createRequestPacer(fireworksRpm);this.groqRpm=groqRpm;this.groqPacer=providers.createRequestPacer(groqRpm);this.openaiRpm=openaiRpm;this.openaiPacer=providers.createRequestPacer(openaiRpm);}
 async init(){for(const d of ['runs','cache','media','tmp'])await mkdir(join(this.root,d),{recursive:true});for(const name of await readdir(join(this.root,'runs'))){if(!name.endsWith('.json')||name.endsWith('.raw.json'))continue;const job=JSON.parse(await readFile(join(this.root,'runs',name),'utf8'));try{const raw=JSON.parse(await readFile(join(this.root,'runs',job.id+'.raw.json'),'utf8'));for(const p of job.posts){p.audioUrl||=raw.find(r=>String(r.shortCode||r.id)===p.id)?.audioUrl||'';if(p.transcript&&p.transcript.text.trim().split(/\s+/).length<6){p.excludedReason='Too little spoken content for script analysis';p.status='no_speech';}}}catch{}if(['running','scraping'].includes(job.status))job.status='interrupted';this.jobs.set(job.id,job);}return this;}
 emit(job){for(const fn of this.listeners)fn(job.id);}
 save(job){this.emit(job);const snapshot=structuredClone(job);const prev=this.writes.get(job.id)||Promise.resolve();const next=prev.catch(()=>{}).then(()=>atomic(join(this.root,'runs',job.id+'.json'),snapshot));this.writes.set(job.id,next);return next;}
 async create(config,rows){
  if(!/^[a-zA-Z0-9_.]{1,30}$/.test(config.creator))throw new Error('Enter a valid Instagram handle');
  const limit=Number(config.limit??20);if(!Number.isInteger(limit)||limit<1||limit>1000)throw new Error('Choose 1 to 1,000 Reels');
  const concurrency=Number(config.concurrency??4);if(!Number.isInteger(concurrency)||concurrency<1||concurrency>12)throw new Error('Concurrency must be 1 to 12');
  const budget=Number(config.budget??3);if(!Number.isFinite(budget)||budget<0.05||budget>30)throw new Error('Apify cap must be $0.05 to $30');
  const language=config.language||'';if(language&&!/^[a-z]{2}$/.test(language))throw new Error('Use a two-letter language code');
  if(rows&&!Array.isArray(rows))throw new Error('Import must be an array of Apify Reel objects');
  const job={id:randomUUID(),creator:config.creator,limit,concurrency,budget,language,status:'ready',createdAt:new Date().toISOString(),schemaVersion:VERSION,posts:rows?deduplicate(rows.slice(0,1000)):[],imported:Boolean(rows),scrape:null,events:[],costs:{apify:null},error:null,elapsedMs:0,retries:0};
  if(rows){await atomic(join(this.root,'runs',job.id+'.raw.json'),rows);job.posts=job.posts.filter(p=>p.creator===config.creator||p.creator==='unknown');if(!job.posts.length)throw new Error('No matching creator Reels in this import');}
  this.jobs.set(job.id,job);await this.save(job);return job;
 }
 event(job,message){job.events.push({at:new Date().toISOString(),message});job.events=job.events.slice(-150);}
 pause(id){const j=this.jobs.get(id);if(!j)throw new Error('Run not found');j.pauseRequested=true;this.event(j,'Pause requested. In-flight requests will finish.');return this.save(j);}
 async run(id){
  const j=this.jobs.get(id);if(!j)throw new Error('Run not found');if(this.active.has(id))return;
  const k=this.keys();const provider=this.transcriptionProvider;const providerName=providers.transcriptionProviders[provider].name;const missing=[];if(!j.imported&&!j.posts.length&&!k.apify)missing.push('Apify');if(j.posts.some(p=>!p.transcript)||(!j.posts.length&&!j.imported)){if(!k[provider])missing.push(providerName);}if(!k.jev)missing.push('Jev');if(missing.length)throw new Error(`Connect ${missing.join(', ')} in Connections first`);
  if(j.scrapeUncertain)throw new Error('Apify launch response was lost. Import the run ID from Apify to avoid starting and charging twice.');
  this.active.add(id);j.pauseRequested=false;j.error=null;j.status=j.posts.length?'running':'scraping';const start=Date.now();this.event(j,`${providerName} pacing: up to ${this[provider+'Rpm']} requests/minute; short rate limits retry automatically`);await this.save(j);
  const work=async()=>{try{
   if(!j.posts.length&&!j.imported){
    if(!j.scrape){j.scrapeUncertain=true;await this.save(j);j.scrape=await providers.startScrape(j,k.apify);j.scrapeUncertain=false;this.event(j,'Apify collecting Reel metadata');await this.save(j);}
    while(!['SUCCEEDED','FAILED','ABORTED','TIMED-OUT'].includes(j.scrape.status)){if(j.pauseRequested){j.status='paused';return;}await providers.delay(2500);j.scrape=await providers.pollScrape(j.scrape.id,k.apify);await this.save(j);}
    j.costs.apify=typeof j.scrape.usageTotalUsd==='number'?j.scrape.usageTotalUsd:null;
    // Keep partial successful rows even when the actor stopped at its cost cap.
    const raw=await providers.dataset(j.scrape.defaultDatasetId,k.apify,j.limit);await atomic(join(this.root,'runs',j.id+'.raw.json'),raw);j.posts=deduplicate(raw);
    if(!j.posts.length)throw new Error(`Apify returned no Reels (${j.scrape.status})`);
    if(j.scrape.status!=='SUCCEEDED')this.event(j,`Apify ${j.scrape.status}; processing ${j.posts.length} returned Reels`);
    j.status='running';this.event(j,`${j.posts.length} unique Reels collected`);await this.save(j);
   }
   let cursor=0;const pending=j.posts.filter(p=>!p.excludedReason&&(!p.analysis||p.analysis.schemaVersion!==VERSION));
   const worker=async()=>{while(cursor<pending.length&&!j.pauseRequested){const p=pending[cursor++];p.error=null;
    try{
     if(!p.transcript){p.status='transcribing';await this.save(j);const cached=await this.readCache(`transcript-${p.id}`);p.transcript=cached||await providers.transcribe(p,k[provider],join(this.root,'tmp'),{provider,language:j.language,pacer:this[provider+'Pacer'],cancelled:()=>j.pauseRequested,onRetry:()=>{j.retries++;this.event(j,`${providerName} retry queued: ${p.id}`);this.emit(j);}});if(cached)p.transcript={...cached,reused:true};else await this.writeCache(`transcript-${p.id}`,p.transcript);p.status='transcribed';this.event(j,`Transcribed ${p.id}`);await this.save(j);}
     if(p.transcript.text.trim().split(/\s+/).length<6){p.excludedReason='Too little spoken content for script analysis';p.status='no_speech';this.event(j,`Skipped short speech: ${p.id}`);await this.save(j);continue;}p.status='classifying';await this.save(j);const key=cacheKey(p.transcript);const cached=await this.readCache(key);p.analysis=cached||await providers.classify(p.transcript,k.jev,()=>{j.retries++;});if(cached)p.analysis={...cached,reused:true};else await this.writeCache(key,p.analysis);
     p.status='complete';this.event(j,`Classified ${p.id}`);
    }catch(e){if(e instanceof providers.NoAudioTrackError){p.status='no_audio';p.excludedReason=e.message;p.error=null;this.event(j,`Skipped media without audio: ${p.id}`);}else if(e instanceof providers.RunPausedError){p.status=p.transcript?'transcribed':'queued';p.error=null;}else{p.status='failed';p.error=e.message;this.event(j,`${p.id}: ${e.message}`);if([401,403,429].includes(e.status)){j.pauseRequested=true;j.error=e.message;}}}
    await this.save(j);
   }};
   await Promise.all(Array.from({length:j.concurrency},worker));
   const seen=new Map();for(const p of j.posts){if(!p.transcript)continue;const fp=fingerprint(p.transcript.text);p.duplicateOf=seen.get(fp)||null;if(!seen.has(fp))seen.set(fp,p.id);}
   j.status=j.pauseRequested?'paused':j.posts.some(p=>p.status==='failed')?'partial':'complete';
  }catch(e){j.status='failed';j.error=e.message;this.event(j,e.message);}finally{j.elapsedMs+=Date.now()-start;this.active.delete(id);await this.save(j);}};
  void work();return j;
 }
 async attachScrape(id,runId){const j=this.jobs.get(id);if(!j||this.active.has(id))throw new Error('Pause the run before attaching an Apify run');if(!/^[\w-]{5,60}$/.test(runId))throw new Error('Invalid Apify run ID');j.scrape=await providers.pollScrape(runId,this.keys().apify);j.scrapeUncertain=false;await this.save(j);}
 async readCache(key){try{return JSON.parse(await readFile(join(this.root,'cache',key+'.json'),'utf8'));}catch{return null;}}
 async writeCache(key,value){await atomic(join(this.root,'cache',key+'.json'),value);}
}
