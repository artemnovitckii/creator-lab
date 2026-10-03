import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
let config={};try{config=parseEnv(await readFile(new URL('../.env',import.meta.url),'utf8'));}catch{}
const value=name=>config[name]||process.env[name];
let failures=0;
function check(name,ok,hint){console.log(`${ok?'OK':'MISSING'} ${name}${ok?'':`: ${hint}`}`);if(!ok)failures++;}
const [major,minor]=process.versions.node.split('.').map(Number);
check('Node.js',major>22||major===22&&minor>=9,'Install Node 24 LTS or Node >=22.9.');
for(const cmd of ['ffmpeg','ffprobe'])check(cmd,spawnSync(cmd,['-version'],{stdio:'ignore'}).status===0,'Install FFmpeg, then reopen your terminal.');
const provider=value('TRANSCRIPTION_PROVIDER')||'fireworks';
const keyNames={fireworks:'FIREWORKS_API_KEY',groq:'GROQ_API_KEY',openai:'OPENAI_API_KEY'};
check('Transcription provider',provider in keyNames,'Set TRANSCRIPTION_PROVIDER to fireworks, groq or openai.');
check('Apify key',Boolean(value('APIFY_TOKEN')||value('APIFY_API_TOKEN')),'Add APIFY_TOKEN to .env.');
check('Jev key',Boolean(value('TYPESAFE_API_KEY')||value('JEV_API_KEY')),'Add TYPESAFE_API_KEY to .env.');
if(provider in keyNames)check(`${provider} key`,Boolean(value(keyNames[provider])),`Add your ${provider} key to .env.`);
console.log('Keys are checked for presence only. No key values are printed and no paid requests are made.');
console.log(failures?'Fix the items above for live analysis. The synthetic demo still works without keys.':'Ready for a pilot. Start the app and verify Connections.');
process.exitCode=failures?1:0;
