# Set up your own creator research dashboard

You need a computer, Node.js, FFmpeg, and three API keys: Apify, TypeSafe Jev, and one speech provider: Fireworks, Groq or OpenAI. You do not need more than one. No Instagram password is requested.

## 1. Install the tools

Install Node.js 24 from [nodejs.org](https://nodejs.org/en/download). Node 22.9 or newer also works. Open a new terminal after installing it.

Install FFmpeg using the option for your computer:

**macOS with Homebrew**

```sh
brew install ffmpeg
```

If you do not have Homebrew, use the macOS build links on [FFmpeg's download page](https://ffmpeg.org/download.html), or install Homebrew from its official site first.

**Windows with WinGet, in PowerShell**

```powershell
winget install --id Gyan.FFmpeg --exact
```

Close and reopen PowerShell after installation. If WinGet is unavailable, use the Windows build links on FFmpeg's download page and add its `bin` folder to PATH.

**Ubuntu / Debian**

```sh
sudo apt update
sudo apt install ffmpeg
```

Verify installation:

```sh
node --version
npm --version
ffmpeg -version
ffprobe -version
```

## 2. Download Creator Lab

On the [repository page](https://github.com/artemnovitckii/creator-lab), click **Code → Download ZIP**, then extract the ZIP. Open a terminal inside the extracted folder, where `package.json` is located.

If you use Git:

```sh
git clone https://github.com/artemnovitckii/creator-lab.git
cd creator-lab
```

Run:

```sh
npm run setup
```

This copies `.env.example` to `.env`. It never overwrites an existing `.env`. Open `.env` with a text editor. Dotfiles may be hidden in Finder; an editor such as VS Code can open the folder and show them.

## 3. Get your keys

| Key | Where to get it | What it does |
| --- | --- | --- |
| Apify | [Apify Console](https://console.apify.com/), account settings / API integrations | Collects Reel URLs, thumbnails and public metrics |
| Jev | [TypeSafe](https://typesafe.ai/), your account's API key settings; [API documentation](https://docs.typesafe.ai/api) | Labels transcripts and script passages |
| Fireworks, one option | [Fireworks account](https://app.fireworks.ai/), API keys | Transcribes audio with Whisper V3 Turbo |
| Groq, alternative | [Groq API keys](https://console.groq.com/keys) | Transcribes audio with Whisper Large V3 Turbo |
| OpenAI, alternative | [OpenAI API keys](https://platform.openai.com/api-keys) | Transcribes audio with Whisper (`whisper-1`) |

Enable the necessary API access and billing in each account. Available plans, credits, quotas, and upgrade availability can change. You are billed by these services, not Creator Lab. The app uses Apify's [Instagram Reel Scraper](https://apify.com/apify/instagram-reel-scraper), Actor ID `xMc5Ga1oCONPmWJIa`.

## 4. Configure one transcription provider

For **Fireworks**, fill these entries in `.env`:

```dotenv
APIFY_TOKEN=your_apify_token
TYPESAFE_API_KEY=your_typesafe_key
TRANSCRIPTION_PROVIDER=fireworks
FIREWORKS_API_KEY=your_fireworks_key
PORT=5190
```

For **Groq**, use:

```dotenv
APIFY_TOKEN=your_apify_token
TYPESAFE_API_KEY=your_typesafe_key
TRANSCRIPTION_PROVIDER=groq
GROQ_API_KEY=your_groq_key
PORT=5190
```

For **OpenAI**, use:

```dotenv
APIFY_TOKEN=your_apify_token
TYPESAFE_API_KEY=your_typesafe_key
TRANSCRIPTION_PROVIDER=openai
OPENAI_API_KEY=your_openai_key
PORT=5190
```

Replace the example values with your own keys. Keep just one value per setting. Leave the unused speech provider keys empty. You do not need to edit any JavaScript.

The default local pacing settings are `FIREWORKS_REQUESTS_PER_MINUTE=60`, `GROQ_REQUESTS_PER_MINUTE=20` and `OPENAI_REQUESTS_PER_MINUTE=60`. These are local ceilings, not a statement of your account quota. Lower them if your account has a lower limit. Audio-duration quotas can also apply.

Keys can alternatively be supplied through environment variables or the app's **Connections** dialog. Dialog keys last until the server stops. `.env` keys persist locally. This distribution does not read a parent folder's `.env`.

## 5. Launch and verify

```sh
npm run doctor
npm start
```

Doctor checks installed tools and key presence without printing keys or calling provider APIs. Open **http://127.0.0.1:5190** in your browser. Keep the terminal open while processing.

Open **Connections** and use **Save & verify connections**. Only Apify, Jev, and the selected speech provider are needed. A missing unused speech key is fine. Verification confirms API access; your first audio request still needs to succeed.

To stop the server, press **Ctrl+C** in its terminal. After editing `.env`, stop and start it again.

## 6. Run a small pilot

1. Choose **New analysis**.
2. Enter the creator's username without `@` or a profile URL. Use your own account or another public creator.
3. Start with **20 Reels**, concurrency **2**, and a small Apify cap such as **$1**. This cap may stop collection before the requested count, and only covers Apify charges.
4. Optionally provide a two-letter speech language code such as `en`; otherwise leave it blank.
5. Start the run. Watch Run activity for collection, transcription, and classification.
6. Inspect a few transcripts and original Reels before collecting a larger batch.

The pipeline downloads media, extracts 16 kHz mono audio with FFmpeg, sends it to your chosen transcription service, and asks Jev to label the resulting speech. Each stage takes real time. The animated replay runs only after results exist.

A run supports up to 1,000 requested Reels. Instagram availability and the scraper determine what is actually returned. Pinned and trial Reels are skipped. This is not a guarantee of analyzing every Reel on any account.

## 7. Use the findings for your next post

Choose a **Topic**, then a **Hook**. The wall, graph and examples narrow together. Select **Compare engagement** to compare patterns using median plays or views, likes per 1,000, and comments per 1,000. Check the sample sizes and keep post age and length comparable.

Open **Read script** or click a thumbnail to inspect its opening, script roles, and transcript. Use **Original Reel** to check how it was delivered. Save an opening structure you can adapt to your own topic and experience. Engagement is a clue to investigate, not proof that copying a hook will reproduce the result.

You can repeat this for your own account to find topics worth revisiting. Each new analysis takes a separate handle; the app does not combine multiple creators into one run.

Use **Replay analysis** for a saved-result animation. Filtering and replay do not trigger new paid analyses. Export JSON when you want a local backup; exports contain creator content and source URLs, so review them before sharing.

## 8. Pause, resume, and change providers

**Pause run** lets in-flight requests finish. **Start / resume** retries unfinished work and preserves completed results. Closing the browser does not stop the server. After a server restart, select the saved run and resume it.

To switch transcription provider: pause, stop the server, change `TRANSCRIPTION_PROVIDER` and the corresponding key in `.env`, restart, and resume. Existing transcripts are reused. Changing provider does not automatically replace transcripts you already paid for.

If an Apify launch response is lost, the app blocks a duplicate launch. Find the existing Actor run ID in Apify, attach it in **Run activity**, then resume. Do not launch another scrape merely because the first response was lost.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| `node` or `npm` not found | Install Node.js, then reopen the terminal. |
| `--env-file-if-exists` unsupported | Upgrade to Node 22.9 or newer. |
| FFmpeg or ffprobe missing | Install FFmpeg and ensure both commands are on PATH. |
| Missing key after editing `.env` | Confirm it is named `.env`, not `.env.txt`, in the same folder as `server.mjs`. Restart. |
| HTTP 401 or 403 | Check the selected provider key, account permissions and billing. |
| HTTP 429 / paused run | Check provider quotas. Wait for reset or lower pacing; then resume. Short rate limits retry automatically. |
| Groq upgrade unavailable | Configure Fireworks instead. Existing transcripts remain cached. |
| No audio / too little speech | These Reels are excluded from spoken-script comparisons. They are not pending labels. |
| Failed download or expired media | Inspect the original Reel. Resume can retry, but an expired source URL may require a fresh collection. |
| Graph has fewer points than Reels | Missing/nonpositive plays or views, unknown likes, age filters, duplicates and exclusions can remove points. |
| No Reels returned | Check the username, whether the account is public, Actor access, budget and the Apify run log. |
| Port already in use | Stop the previous server, or set `PORT=5191` and open that port. |
| Page stops responding after restart | Refresh the browser to obtain a new local request token. |

## Costs, privacy and sharing

The app's estimated costs are separate for collection, speech and Jev. Account minimums, retries and rate changes can affect the actual bill. Provider billing is authoritative. [Groq speech documentation](https://console.groq.com/docs/speech-to-text), [Apify Actor pricing](https://apify.com/apify/instagram-reel-scraper/pricing), and [TypeSafe documentation](https://docs.typesafe.ai/) are the starting points for current terms. The Fireworks implementation uses its Whisper Turbo audio endpoint; confirm availability in your account.

Do not publish `.env`, `data/`, screenshots of keys, or your exported archive by accident. These files are excluded from Git by default. [Read the data flow](PRIVACY.md). The server is intended for your own computer, not public hosting.

## Record the demo

Open **Recording studio** from the dashboard, or visit **http://127.0.0.1:5190/record**. Choose your saved archive and a layout:

- **Scanner:** a paged thumbnail grid, large current-Reel analysis, counters and hook-frequency bars.
- **Wall + map:** larger thumbnails fill the wall while corresponding points appear on the engagement map. The axis explicitly names plays or views, whichever the archive supports; they are never combined.
- **Script breakdown:** a large Reel image and readable excerpts with Jev's script-role labels.

Choose 12, 20 or 40 seconds, press Play, then **Clean view** to hide the controls. Press **C** to bring controls back, **Space** to pause, and **R** to restart. The timeline slider lets you inspect any frame. Loop adds a short hold at the end.

The canvas is 1080 × 1000 and scales to your window. Crop your screen recording around it and place it over your portrait footage. It is intentionally taller than the full research dashboard so the text stays larger on a phone. Script excerpts can be visually truncated; use the main dashboard to read the full transcript.

The recording cost counter sums stored Jev estimates for the revealed scripts, including reused results; it is not a new charge or a complete pipeline invoice. Missing costs display as unknown. The synthetic rehearsal has no real cost. All these layouts replay saved results and make no new paid analysis calls.
