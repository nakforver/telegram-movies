# Telegram Movie Library Mini App

A production-ready Telegram Mini App for browsing and playing a movie and series catalog stored in Google Sheets and Telegram. The React/Vite/TypeScript frontend, Node/TypeScript API, static assets, and server-side secrets are deployed together to Wasmer Edge.

## Architecture

```text
Telegram Mini App
        ↓
Wasmer API + static frontend
        ↓
Telegram webhook → Cloudflare R2
        ↓
Google Sheets catalog
        ↓
HTML5 player
```

- **Frontend:** React 19, Vite, TypeScript, Telegram Mini App SDK
- **Backend:** Node.js 20+, TypeScript, native `node:http`
- **Catalog:** Google Sheets, accessed only by the server
- **Hosting:** Wasmer Edge Node workload
- **User state:** Device-local favorites and watch history
- **Source:** GitHub `nakforver/telegram-movies`

## Features

- Mobile-first dark UI with Home, Search, Categories, Favorites, History, Profile, Details, Series, Episodes, and Player
- Bottom navigation for Telegram mobile
- Trending, Recently Added, Featured, Movies, and Series shelves
- Movie cards with poster, English title, Khmer title, year, genre, rating, category, country, and duration
- Debounced search across English, Khmer, original title, year, and genre
- Server-side catalog filtering and pagination
- Series seasons and episode records with independent Telegram references
- Favorites, watch history, and continue-watching playback metadata
- Protected server-side admin write/import APIs
- Server-side Google Sheets client caching
- Consistent `{ success, data }` and `{ success, error }` JSON responses

## Google Sheets Setup

1. Create a Google Cloud service account and enable the Google Sheets API.
2. Create/share a spreadsheet with the service-account email as **Editor**.
3. Create a worksheet named `Movies` (or set `GOOGLE_WORKSHEET_NAME`).
4. Add an exact header row in row 1:

```text
movie_id | title | title_km | original_title | description | poster_url | backdrop_url | category | genre | year | country | duration | rating | type | season | episode | telegram_chat_id | telegram_message_id | telegram_file_id | telegram_file_size | status | created_at | updated_at | media_source | media_url | media_object_key | media_status_reason
```

Values are read starting at row 2. Set `status` to `published` or `draft`, `type` to `movie` or `series`, and `media_source` to `r2` only after the object exists in R2. Existing supported 22-column sheets are automatically upgraded to the full schema.

For a series, store a parent row (without `episode`) and one row per episode. Use the same `title` for episode rows, include `season`, and number `episode`. Each row may have its own Telegram chat/message/file reference.

Google private keys are read only by the backend and are never included in browser assets or API responses.

## Telegram Bot Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. Set the deployed HTTPS URL in BotFather using `/setmenubutton`.
3. Configure commands with `/setcommands` or run:

```bash
npm run telegram:setup
```

4. Bot commands:

- `/start` – introduces the app and shows **🎬 Open Movie App**
- `/movies` – points users to the movie catalog
- `/search` – points users to search
- `/help` – shows support information

The button URL is the production `MINI_APP_URL`, copied by the user in Telegram and supported by the server-side setup utility.

## Environment Variables

Copy `.env.example` for local development. Configure the same variables as Wasmer app secrets or GitHub Actions secrets.

```text
NODE_ENV=production
PORT=8080
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_API_BASE=https://api.telegram.org
MINI_APP_URL=
GOOGLE_SPREADSHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_WORKSHEET_NAME=Movies
ADMIN_SECRET=
FRONTEND_URL=
CACHE_TTL_MS=300000
WASMER_TOKEN=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
PLAYBACK_TOKEN_SECRET=
```

- Backend-only secrets must not use the `VITE_` prefix.
- If Sheets credentials are absent, the API starts safely with an empty in-memory catalog and `/api/health` reports the missing integration.
- `GOOGLE_PRIVATE_KEY` supports either a literal newline or JSON-style `\n` escapes.
- `ADMIN_SECRET` must be a long random value and is accepted only through the `X-Admin-Secret` header.

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

The API listens on `http://localhost:8080`; Vite serves the UI on `http://localhost:5173` and proxies `/api`.

Validation:

```bash
npm test
npm run build
npm start
```

## API

All responses use the same envelope. Successful responses use `{ "success": true, "data": ... }`; errors use `{ "success": false, "error": "..." }`.

- `GET /api/health`
- `GET /api/movies?page=&pageSize=&type=&category=&genre=&year=&sort=`
- `GET /api/movies/:id`
- `GET /api/categories`
- `GET /api/search?q=&page=&pageSize=&type=&category=&genre=&year=`
- `GET /api/episodes/:movieId`
- `GET /api/play/:id`
- `POST /api/admin/movies`
- `POST /api/admin/movies/:movieId/transfer` – retries Telegram-to-R2 transfer for an existing catalog record
- `PUT /api/admin/movies/:id`
- `DELETE /api/admin/movies/:id`
- `POST /api/admin/import-telegram`

Filtering and pagination happen after a cached Sheets read, preventing repeated Sheets requests on every user action.

## Admin Workflow

Use any HTTP client with `X-Admin-Secret`. Example:

```bash
curl -X POST https://telegram-movies.wasmer.app/api/admin/movies \
  -H 'content-type: application/json' \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -d '{
    "movie_id": "movie-001",
    "title": "Example",
    "type": "movie",
    "status": "published",
    "category": "Action",
    "genre": "Action",
    "poster_url": "https://example.com/poster.jpg",
    "telegram_chat_id": "-100123456789",
    "telegram_message_id": "42"
  }'
```

Use PUT to edit or resolve an episode, DELETE to remove a record, and `POST /api/admin/import-telegram` to insert a draft from a Telegram chat/message reference. You can edit `telegram_message_id`, `telegram_file_id`, poster URL, category, status, and all other catalog fields. Imports start as drafts and are never automatically published.

Missing or invalid admin credentials are rejected server-side. Admin APIs do not have a public browser form or embed the secret in frontend code.

## Video Playback Architecture

Telegram channel posts are the ingestion trigger. On webhook receipt, the server maps the post to the catalog schema and attempts an automatic Telegram-to-R2 transfer:

1. `getFile` resolves a temporary Telegram download URL.
2. The server streams the response body directly to R2 using a signed `PUT`.
3. Only after R2 confirms the upload does the backend write `media_source=r2`, `media_object_key`, and durable R2 metadata to Google Sheets.
4. `GET /api/play/:id` returns a short-lived Wasmer backend URL with an HMAC playback token. The browser never receives Telegram or R2 credentials.
5. `GET /api/media/:id` verifies the token, creates a short-lived presigned R2 GET, forwards Range requests, and streams the response with `206 Partial Content` support.

The public Telegram Bot API can resolve and download only files up to approximately 20 MB. Larger movies are stored in Sheets (or marked by an authenticated retry) with a clear `media_status_reason` and remain non-playable instead of being faked. This is a Telegram Bot API limitation, not a Wasmer or R2 limitation.

For full-size channel-only uploads, run a self-hosted Telegram Bot API server and expose it to Wasmer through an authenticated HTTPS reverse proxy. Set `TELEGRAM_API_BASE` to that proxy endpoint, configure R2, redeploy, run `npm run telegram:setup`, then republish the channel video or call `POST /api/admin/movies/:movieId/transfer` for an existing record. Without that server, upload the video to R2 separately and set its row to `media_source=r2` plus the object key.

Cloudflare setup:

1. Create an R2 bucket.
2. Create an Object Storage API token with write access for ingestion and read access for playback.
3. Store the account ID, access key ID, secret access key, and bucket name as Wasmer secrets.
4. Do not expose the R2 S3 endpoint or public bucket URL; the backend generates short-lived signed URLs server-side.

## Wasmer Deployment

The repository uses a verified Node provider configuration in `app.yaml`. Node.js is available locally and in the account's existing Edge Node workload configuration.

Deploy from the repository root:

```bash
npm ci
npm test
npm run build
./scripts/deploy-wasmer.sh
```

GitHub Actions can deploy by storing `WASMER_TOKEN`, Sheets credentials, Telegram token/chat ID, mini-app URL, frontend URL, and admin secret as repository secrets. The workflow builds with Node 22 and invokes the same deployment command.

Wasmer app secrets should be configured once using:

```bash
wasmer app secret create NAME value --app wechatfree011/telegram-movies
```

Secrets are not committed. Required secrets are listed under **Environment Variables**.

The default production URL is `https://telegram-movies.wasmer.app` (subject to Wasmer alias availability).

## GitHub Workflow

1. Push to `main`.
2. GitHub Actions runs tests, frontend type checking, and the production build.
3. Install dependencies with `npm ci`.
4. Deployment uses the Wasmer CLI, `deploy/wasmer.toml`, and `edge/app.yaml`.
5. Test `/api/health`, `/api/movies`, `/api/categories`, `/api/search?q=`, and an invalid ID after each deployment.

## Known Limitations

- Without configured Sheets credentials, the app deploys and responds correctly but has an empty catalog.
- The current player is architecture-ready but does not fetch or proxy a Telegram media stream.
- Favorites/history are local to the Telegram/browser instance, which avoids server credential exposure but does not synchronize across devices.
- `movies` and `search` bot commands are registered; persistent webhook-bot response behavior can be added in a future deployment.
- Wasmer secrets were not populated during this repository build because no catalog credentials or admin secret were provided.

## Troubleshooting

- **Empty catalog:** verify `GOOGLE_SPREADSHEET_ID`, service-account email, private key, and spreadsheet sharing; check the exact worksheet name and header row.
- **`Private key is invalid`:** ensure `GOOGLE_PRIVATE_KEY` retains newlines or uses `\n` escapes.
- **Mini App does not open:** confirm `MINI_APP_URL` is HTTPS and points to the deployed Wasmer app; re-run BotFather `/setmenubutton` or `npm run telegram:setup`.
- **Admin returns 401:** verify the `X-Admin-Secret` header and Wasmer secret value.
- **Images do not load:** ensure poster/backdrop URLs are HTTPS and directly browser-accessible.
- **Deployment fails:** run `npm run build` locally first, then inspect `wasmer app logs wechatfree011/telegram-movies --from 1h --max 200`.
- **Collection appears stale:** wait for `CACHE_TTL_MS`, or update a record through admin APIs, which invalidates the cache.

## Final Verification

Before production use, verify:

- GitHub Actions build succeeds
- `/api/health` reports configured integrations
- `/api/movies`, `/api/categories`, and `/api/search?q=` return catalog data
- invalid IDs and missing Telegram references do not crash the API
- movie details, series, and episodes return data
- the Mini App opens from Telegram over HTTPS
- favorites and history work locally
- the player reports missing Telegram references clearly
