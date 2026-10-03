import {writeFile,readFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {buildRequest,parseResult} from './schema.mjs';
const exec=promisify(execFile);
export const delay=ms=>new Promise(r=>setTimeout(r,ms));
export class NoAudioTrackError extends Error {constructor(){super('No audio track in the available media. Excluded from spoken-script analysis.');this.name='NoAudioTrackError';}}
export class RunPausedError extends Error {constructor(){super('Run paused before the next request');this.name='RunPausedError';}}
// One shared queue spaces starts, including retries, across every worker.
export function createRequestPacer(rpm=20,{now=Date.now,sleep=delay}={}){
 if(!Number.isFinite(rpm)||rpm<1)throw new Error('Requests per minute must be a positive number');
 const interval=60000/rpm+100;let next=0,tail=Promise.resolve();
 return {
  cooldown(ms){next=Math.max(next,now()+ms);},
  wait(cancelled=()=>false){const turn=tail.catch(()=>{}).then(async()=>{for(;;){if(cancelled())throw new RunPausedError();const remaining=next-now();if(remaining<=0)break;await sleep(Math.min(1000,remaining));}next=now()+interval;});tail=turn;return turn;}
 };
}
export class ProviderError extends Error {constructor(service,status,detail=''){super(`${service}: HTTP ${status}. ${status===401||status===403?'Check the API key and account access.':status===429?'Rate limit reached; resume after the account limit resets.':'Request failed. Retry the unfinished items.'}`);this.status=status;if(detail)this.message+=' '+detail;}}
export async function request(url,options={}, {service='Service',retries=3,rateRetries=retries,onRetry=()=>{},beforeAttempt=()=>{},onRateLimit=()=>{},sleep=delay}={}){
 let rateAttempts=0;
 for(let attempt=0;;attempt++){
  await beforeAttempt();
  let response;try{response=await fetch(url,{...options,signal:AbortSignal.timeout(90000)});}catch(e){if(attempt>=retries)throw new Error(`${service}: connection failed or timed out`);onRetry();await delay(1000*2**attempt);continue;}
  if(response.ok)return response;
  let detail='';try{const payload=await response.json();detail=String(payload.error?.message||payload.detail||'').replaceAll(String(options.headers?.Authorization||'').replace(/^Bearer /,'' )||'\0','[redacted]').replace(/https?:\/\/\S+/g,'[provider link]').replace(/(?:gsk_|apify_api_|sk-)[A-Za-z0-9_-]+/g,'[redacted]').slice(0,550);}catch{}
  if((response.status===429&&rateAttempts<rateRetries)||(response.status>=500&&attempt<retries)){
   const header=response.headers.get('retry-after');const seconds=Number(header);const wait=header?(Number.isFinite(seconds)?seconds*1000:Date.parse(header)-Date.now()):1000*2**attempt;
   if(wait>60000)throw new ProviderError(service,response.status,detail);
   const waitMs=Math.max(1000,Math.min(60000,wait||1000));if(response.status===429){rateAttempts++;onRateLimit(waitMs+250);}
   onRetry();await sleep(waitMs);continue;
  }
  throw new ProviderError(service,response.status,detail);
 }
}
export const auth=key=>({Authorization:`Bearer ${key}`});
export function mediaURL(raw){
 let u;try{u=new URL(raw);}catch{throw new Error('No usable media URL');}
 const h=u.hostname.toLowerCase();const domains=['cdninstagram.com','fbcdn.net','apifyusercontent.com'];
 if(u.protocol!=='https:'||u.username||u.password||!domains.some(d=>h===d||h.endsWith('.'+d)))throw new Error('Media URL must come from Instagram or Apify CDN');
 return u.href;
}
export async function download(raw,maxBytes=80*1024*1024){
 let url=mediaURL(raw);
 for(let i=0;i<4;i++){
  const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(60000)});
  if(r.status>=300&&r.status<400){url=mediaURL(new URL(r.headers.get('location'),url).href);await r.body?.cancel();continue;}
  if(!r.ok)throw new Error(`Media download failed (${r.status}); refresh the source URLs`);
  const chunks=[];let total=0;for await(const chunk of r.body){total+=chunk.length;if(total>maxBytes)throw new Error('Media exceeds download size limit');chunks.push(chunk);}return {bytes:Buffer.concat(chunks),type:r.headers.get('content-type')||''};
 }
 throw new Error('Too many media redirects');
}
export async function startScrape({creator,limit,budget},key){
 const r=await request(`https://api.apify.com/v2/acts/xMc5Ga1oCONPmWJIa/runs?maxTotalChargeUsd=${budget}`,{method:'POST',headers:{...auth(key),'Content-Type':'application/json'},body:JSON.stringify({username:[creator],resultsLimit:limit,includeSharesCount:false,includeTranscript:false,includeDownloadedVideo:false,skipPinnedPosts:true,skipTrialReels:true})},{service:'Apify',retries:0});
 return (await r.json()).data;
}
export async function pollScrape(id,key){return (await (await request(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(id)}`,{headers:auth(key)},{service:'Apify'})).json()).data;}
export async function dataset(id,key,limit=1000){
 const rows=[];for(let offset=0;offset<limit;offset+=250){const page=await (await request(`https://api.apify.com/v2/datasets/${encodeURIComponent(id)}/items?clean=true&format=json&offset=${offset}&limit=${Math.min(250,limit-offset)}`,{headers:auth(key)},{service:'Apify'})).json();if(!Array.isArray(page))throw new Error('Invalid Apify dataset');rows.push(...page);if(page.length<250)break;}return rows;
}
export const transcriptionProviders={
 groq:{name:'Groq',model:'whisper-large-v3-turbo',endpoint:'https://api.groq.com/openai/v1/audio/transcriptions',perMinute:0.04/60},
 fireworks:{name:'Fireworks',model:'whisper-v3-turbo',endpoint:'https://audio-turbo.api.fireworks.ai/v1/audio/transcriptions',perMinute:0.0009},
 openai:{name:'OpenAI',model:'whisper-1',endpoint:'https://api.openai.com/v1/audio/transcriptions',perMinute:0.006}
};
// Extract from the audio URL first, then the original video if that source fails.
export async function prepareAudio(post,tmpDir,{cancelled=()=>false}={}){
 const urls=[...new Set([post.audioUrl,post.videoUrl].filter(Boolean))];let lastError,noAudioCount=0;
 for(const url of urls){
  if(cancelled())throw new RunPausedError();
  const base=join(tmpDir,randomUUID());
  try{
   const {bytes}=await download(url);await writeFile(base+'.media',bytes,{mode:0o600});
   const mediaProbe=await exec('ffprobe',['-v','error','-show_entries','stream=codec_type','-of','json',base+'.media'],{timeout:15000});
   const streams=JSON.parse(mediaProbe.stdout).streams;if(!Array.isArray(streams))throw new Error('Could not inspect source audio');
   if(!streams.some(stream=>stream.codec_type==='audio')){noAudioCount++;throw new NoAudioTrackError();}
   try{await exec('ffmpeg',['-y','-v','error','-i',base+'.media','-vn','-ar','16000','-ac','1',base+'.flac'],{timeout:60000,maxBuffer:1024*1024});}catch{throw new Error('No usable audio track. Refresh the source audio URL or inspect the original Reel.');}
   const audio=await readFile(base+'.flac');if(audio.length>25*1024*1024)throw new Error('Audio exceeds upload limit');
   const probe=await exec('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',base+'.flac'],{timeout:15000});
   const seconds=Number(probe.stdout.trim());return {audio,duration:Number.isFinite(seconds)&&seconds>0?seconds:null};
  }catch(e){lastError=e;}finally{await Promise.allSettled([unlink(base+'.media'),unlink(base+'.flac')]);}
 }
 if(urls.length&&noAudioCount===urls.length)throw new NoAudioTrackError();
 throw lastError instanceof NoAudioTrackError?new Error('One source has no audio; another source could not be verified. Refresh the media URLs.'):lastError||new Error('No usable media URL');
}
export async function transcribe(post,key,tmpDir,{provider='groq',language='',onRetry=()=>{},pacer,cancelled=()=>false}={}){
 const settings=transcriptionProviders[provider];if(!settings)throw new Error('Unsupported transcription provider');
 const begin=Date.now();let prepared;
 const send=async(file)=>{
  const form=new FormData();form.append('model',settings.model);form.append('response_format','verbose_json');form.append('timestamp_granularities[]','segment');form.append('temperature','0');if(language)form.append('language',language);
  if(file)form.append('file',new Blob([file],{type:'audio/flac'}),'audio.flac');else form.append('url',mediaURL(post.audioUrl||post.videoUrl));
  const r=await request(settings.endpoint,{method:'POST',headers:auth(key),body:form},{service:settings.name,onRetry,rateRetries:10,beforeAttempt:async()=>{if(cancelled())throw new RunPausedError();await pacer?.wait(cancelled);},onRateLimit:ms=>pacer?.cooldown(ms)});return r.json();
 };
 let raw;
 if(provider==='fireworks'||provider==='openai'){prepared=await prepareAudio(post,tmpDir,{cancelled});raw=await send(prepared.audio);}
 else try{raw=await send();}catch(e){
  if(!(e instanceof ProviderError)||![400,413,422,504].includes(e.status))throw e;
  prepared=await prepareAudio(post,tmpDir,{cancelled});raw=await send(prepared.audio);
 }
 if(typeof raw.text!=='string'||!raw.text.trim())throw new Error('No speech detected in Reel');
 const duration=Number.isFinite(raw.duration)?raw.duration:prepared?.duration??post.duration??null;
 const billedDuration=provider==='groq'?Math.max(10,duration):duration;
 return {text:raw.text,segments:Array.isArray(raw.segments)?raw.segments:[],source:provider,model:settings.model,duration,costUsd:duration===null?null:provider==='groq'?billedDuration/3600*0.04:billedDuration/60*settings.perMinute,elapsedMs:Date.now()-begin,raw};
}
export async function classify(transcript,key,onRetry=()=>{}){
 const req=buildRequest(transcript),begin=Date.now();
 const raw=await (await request('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{...auth(key),'Content-Type':'application/json'},body:JSON.stringify(req)},{service:'Jev',onRetry})).json();
 return {...parseResult(raw,req),raw,elapsedMs:Date.now()-begin,completedAt:new Date().toISOString()};
}
export async function checkProvider(name,key){
 const urls={apify:'https://api.apify.com/v2/users/me',groq:'https://api.groq.com/openai/v1/models',fireworks:'https://api.fireworks.ai/inference/v1/models',openai:'https://api.openai.com/v1/models',jev:'https://api.typesafe.ai/v1/models'};
 if(!key)return {configured:false,verified:false};
 try{const r=await request(urls[name],{headers:auth(key)},{service:name,retries:0});await r.body?.cancel();return {configured:true,verified:true};}catch(e){return {configured:true,verified:false,error:e.message};}
}
