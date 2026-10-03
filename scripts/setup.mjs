import {copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
try {
 await copyFile(new URL('.env.example',root),new URL('.env',root),constants.COPYFILE_EXCL);
 console.log('Created .env. Open it in your text editor and add your keys.');
} catch(error) {
 if(error.code!=='EEXIST')throw error;
 console.log('Your existing .env was preserved.');
}
console.log(`Configuration: ${fileURLToPath(new URL('.env',root))}`);
console.log('Choose TRANSCRIPTION_PROVIDER=fireworks, groq or openai. You only need the selected transcription key.\nThen run npm run doctor and npm start. Never share your .env.');
