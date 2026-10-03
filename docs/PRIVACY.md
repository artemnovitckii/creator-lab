# Data flow and local files

- The app listens on `127.0.0.1`, not on all network interfaces. It has no multi-user authentication and should not be exposed as a public server.
- Keys come from this app's `.env`, process environment, or the Connections dialog. Dialog keys are held in server memory. The API returns configured/verified flags, not key values. Keys are sent to their corresponding provider for authentication.
- Apify receives the creator handle and scrape configuration.
- The server downloads supported Instagram/CDN media and extracts audio locally. Temporary extraction files are removed after processing.
- Fireworks, Groq or OpenAI receives extracted audio for transcription. Only the selected provider is used.
- TypeSafe Jev receives transcript text and segment identifiers for classification. It does not receive the post's engagement metrics or caption in the classification request.
- The browser loads Google Fonts. Original-Reel links open Instagram; video previews and thumbnails may make source-media requests.
- `data/runs/` stores run state, provider responses and raw imported/scraped rows. `data/cache/` stores transcripts and classifications. `data/media/` stores thumbnails. Treat this directory as private project data.
- JSON exports omit raw transcription and classification response objects and do not include API keys. They still contain creator content, metrics and source media URLs; review before sharing.
- `.gitignore` excludes local credentials and generated data. It is a safeguard, not a substitute for reviewing files before publishing.

Provider retention and use policies are controlled by those services. Running the interface locally does not mean all processing stays on your computer.
