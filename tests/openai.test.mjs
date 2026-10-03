import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pipeline} from '../lib/pipeline.mjs';
import {transcribe,RunPausedError,request,checkProvider} from '../lib/providers.mjs';
// A valid one-second WAV exercises real ffmpeg extraction and duration measurement.
function wav(){const b=Buffer.alloc(44+32000);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(32000,40);return b;}
const row={id:'openai-fixture',ownerUsername:'tester',audioUrl:'https://scontent.cdninstagram.com/audio.m4a',videoUrl:'https://scontent.cdninstagram.com/video.mp4',videoDuration:400};
test('OpenAI uploads extracted audio to whisper-1 and records cost',async()=>{
 const root=await mkdtemp(join(tmpdir(),'openai-test-')),old=global.fetch;let uploads=0;
 global.fetch=async(url,opts)=>{
  url=String(url);
  if(url.includes('cdninstagram.com'))return new Response(wav());
  if(url==='https://api.openai.com/v1/audio/transcriptions'){uploads++;assert.equal(opts.headers.Authorization,'Bearer sk-test');assert.equal(opts.body.get('model'),'whisper-1');assert.equal(opts.body.get('response_format'),'verbose_json');assert.equal(opts.body.get('url'),null);assert.equal(opts.body.get('file').type,'audio/flac');return Response.json({text:'Pick one task and finish it today.',duration:1,segments:[{start:0,end:1,text:'Pick one task and finish it today.'}]});}
  throw new Error('Unexpected request '+url);
 };
 try{
  const result=await transcribe(row,'sk-test',join(root),{provider:'openai'});
  assert.equal(uploads,1);assert.equal(result.source,'openai');assert.equal(result.model,'whisper-1');assert.equal(result.duration,1);assert.ok(Math.abs(result.costUsd-.006/60)<1e-12);assert.equal(result.segments[0].end,1);
 }finally{global.fetch=old;await rm(root,{recursive:true,force:true});}
});
test('OpenAI selection never silently uses other providers\' credentials',async()=>{const root=await mkdtemp(join(tmpdir(),'openai-key-'));try{const p=await new Pipeline(root,()=>({groq:'test',fireworks:'test',jev:'test'}),{transcriptionProvider:'openai'}).init();const j=await p.create({creator:'tester'},[row]);await assert.rejects(p.run(j.id),/Connect OpenAI/);assert.equal(j.status,'ready');}finally{await rm(root,{recursive:true,force:true});}});
test('paused OpenAI work sends no audio',async()=>{await assert.rejects(transcribe(row,'sk-test',tmpdir(),{provider:'openai',cancelled:()=>true}),RunPausedError);});
test('provider errors redact reflected OpenAI keys',async()=>{const old=global.fetch;global.fetch=async()=>Response.json({error:{message:'Incorrect API key provided: sk-proj-abc123. You can find your key at https://platform.openai.com/account/api-keys.'}},{status:401});try{await assert.rejects(request('https://api.openai.com/v1/models',{headers:{Authorization:'Bearer sk-proj-abc123'}},{service:'OpenAI',retries:0}),e=>!e.message.includes('sk-proj')&&e.message.includes('OpenAI: HTTP 401'));}finally{global.fetch=old;}});
test('OpenAI connection check calls the models endpoint',async()=>{const old=global.fetch;let seen;global.fetch=async(url,opts)=>{seen=[String(url),opts.headers.Authorization];return Response.json({data:[]});};try{assert.deepEqual(await checkProvider('openai','sk-test'),{configured:true,verified:true});assert.deepEqual(seen,['https://api.openai.com/v1/models','Bearer sk-test']);}finally{global.fetch=old;}});
