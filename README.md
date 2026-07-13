# gl_analyzer_qbo

QBO-connected GL analyzer: OAuth 2.0 → pull GL from QuickBooks → rules classify → Claude
fallback for ambiguous rows → editable grid → export.

## Architecture

Three deployable pieces:

| Service | What it is | Config |
|---|---|---|
| `api` | FastAPI backend | `railway.json` (repo root) → `api/Dockerfile` |
| `frontend` | React app served by nginx, proxies `/api/*` to the backend | `frontend/railway.json` → `frontend/Dockerfile` |
| Postgres | Encrypted token storage (`qbo_tokens`) | Railway-managed plugin, not a Dockerfile — see [Railway deploy steps](#railway-deploy-steps) |

There is no single multi-service `railway.json` — Railway's config-as-code schema
(`build`/`deploy`/`environments`) covers one service per file, so `api` and `frontend`
each carry their own, and Postgres is provisioned as a managed database plugin rather
than something you build from source.

In production the browser only ever talks to the frontend's domain: nginx serves the
React build and reverse-proxies `/api/*` to the API service over Railway's private
network (see `frontend/nginx.conf`), so there's no cross-origin request in production
and the OAuth session cookie stays same-site. Locally, the two run on different ports
and talk over CORS instead (see below).

---

## Local dev setup

**Prerequisites:** Python 3.12+, Node 20+, a local or Dockerized PostgreSQL, and
[ngrok](https://ngrok.com/) (Intuit requires an HTTPS redirect URI, even for a
development app — plain `http://localhost` will not work for the OAuth callback).

### 1. Backend

```bash
pip install -r api/requirements.txt
cp .env.example .env
```

Fill in `.env` — see [Intuit Developer Portal setup](#intuit-developer-portal-setup)
below for `QBO_CLIENT_ID`/`QBO_CLIENT_SECRET`, and generate the two secrets:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # FERNET_KEY
python -c "import secrets; print(secrets.token_hex(32))"                                    # SESSION_SECRET
```

Point `DATABASE_URL` at your local Postgres, then run migrations:

```bash
python -m alembic upgrade head
```

### 2. ngrok — read this before starting the servers

Intuit's OAuth redirect happens in the browser, so **both** `/connect` and `/callback`
must be reached through the *same* HTTPS origin for the CSRF session cookie set on
`/connect` to come back on `/callback` — hitting `/connect` on plain
`http://localhost:8000` and having Intuit redirect to an `https://*.ngrok-free.app`
`/callback` is two different origins to the browser, and the cookie won't follow.
Concretely, that means the ngrok tunnel fronts the **API**, and the frontend calls the
API through that tunnel rather than through `localhost:8000` — only the post-OAuth
redirect back to the app UI (`FRONTEND_URL`) stays on plain `localhost`, since that hop
is a normal browser redirect Intuit isn't involved in.

```bash
uvicorn api.main:app --reload --port 8000
ngrok http 8000
```

Note the `https://<subdomain>.ngrok-free.app` forwarding URL ngrok prints, then:

- Set `QBO_REDIRECT_URI=https://<subdomain>.ngrok-free.app/callback` in `.env`
  (restart uvicorn after editing) and register the same URI in the Intuit Developer
  Portal (see below).
- Set `FRONTEND_URL=http://localhost:5173` in `.env` — this is where `/callback`
  redirects the browser *after* the OAuth dance completes, not part of it.

Free ngrok URLs change every restart, so this — and the matching Intuit portal entry —
needs updating each session unless you're on a paid ngrok plan with a reserved domain.

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env
```

Set `VITE_API_BASE_URL` in `frontend/.env` to the **ngrok URL**, not
`http://localhost:8000` — per the same-origin requirement above.

```bash
npm run dev
```

Visit `http://localhost:5173` and click **Connect to QuickBooks**.

---

## Intuit Developer Portal setup

1. Sign in at [developer.intuit.com](https://developer.intuit.com) and create an app
   (**My Apps → Create an app**, QuickBooks Online and Payments platform).
2. Under **Scopes**, enable `com.intuit.quickbooks.accounting` — the only scope this
   app requests (see `SCOPE` in `api/qbo_client.py`).
3. Under **Keys & OAuth**, copy the **Development** Client ID and Client Secret into
   `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET`. Production keys are a separate pair, issued
   under the same tab once you're ready to point at a real deployment — see
   [Set app redirect URIs](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/set-redirect-uri)
   and the [OAuth 2.0 setup guide](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0).
4. Add redirect URIs:
   - **Development**: `https://<your-ngrok-subdomain>.ngrok-free.app/callback`
   - **Production**: `https://<your-frontend-domain>/api/callback` — note the `/api`
     prefix. In production the browser only ever reaches the frontend's domain; nginx
     strips `/api/` and forwards to the backend's `/callback` route (see
     `frontend/nginx.conf`). Registering the bare backend domain instead will not
     match what Intuit actually redirects to.
5. Get the official **"Connect to QuickBooks"** button asset and usage rules from
   [Connect to QuickBooks — button guidelines](https://help.developer.intuit.com/s/topic/0TOG00000004qsIOAQ/connect-to-quickbooks)
   if you need a different size/color than the one already wired up in
   `frontend/src/components/ConnectQBO.jsx`.

---

## Railway deploy steps

1. **Create the Postgres service.** New → Database → Add PostgreSQL. This is the `db`
   service — Railway manages it directly, no Dockerfile or `railway.json` involved.
2. **Create the `api` service.** New → GitHub Repo → select this repo → set **Root
   Directory** to `/` (repo root, not `api/` — the root `railway.json` targets
   `api/Dockerfile`, and the start command `uvicorn api.main:app ...` needs the repo
   root on the Python path to resolve the `api` package, and `alembic.ini` +
   `migrations/` need to be alongside it for the pre-deploy migration step).
   Set variables:
   - `ANTHROPIC_API_KEY`, `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `FERNET_KEY`,
     `SESSION_SECRET` — same values/generation as local dev.
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (Railway variable reference to the
     database service — adjust the service name if you renamed it).
   - `QBO_REDIRECT_URI` and `FRONTEND_URL` — leave placeholders for now; the frontend's
     domain doesn't exist until step 3.
   - `preDeployCommand` (`python -m alembic upgrade head`, already in `railway.json`)
     runs automatically before every deploy — no separate migration step needed.
3. **Create the `frontend` service.** New → GitHub Repo → same repo → **Root
   Directory** `frontend`. Set:
   - Build argument `VITE_API_BASE_URL=/api` (this is already the Dockerfile's
     default — set it explicitly if Railway's UI doesn't pick up `ARG` defaults for
     Dockerfile builds).
   - Runtime variable `API_INTERNAL_HOST=${{api.RAILWAY_PRIVATE_DOMAIN}}` — this is
     what `frontend/nginx.conf` proxies `/api/*` to, resolved at container start via
     envsubst (see the comment at the top of that file). Replace `api` with whatever
     you actually named the backend service.
   - Generate a public domain (**Settings → Networking → Generate Domain**). This is
     the app's real URL, and the only one your users see.
4. **Wire the domain back into `api`.** Now that the frontend's public domain exists,
   go back to the `api` service and set:
   - `FRONTEND_URL=https://<frontend-public-domain>`
   - `QBO_REDIRECT_URI=https://<frontend-public-domain>/api/callback`
   
   Redeploy `api` for the new variables to take effect.
5. **Register the production redirect URI** (`https://<frontend-public-domain>/api/callback`)
   in the Intuit Developer Portal under Production Keys.
6. Visit the frontend's public domain and run through Connect → Sync → Review against
   a real (or sandbox) QuickBooks company to confirm the deployed OAuth round trip
   works end to end before submitting to the App Store.

The `api` service does not need a public domain for the app to function — the
frontend reaches it over Railway's private network. Leave one enabled only if you
want to hit `/health` or the OpenAPI docs directly for debugging.

---

## App Store submission checklist

Already handled in code — verify before submitting, don't take it on faith:

- [ ] Tokens encrypted at rest (Fernet, `api/token_store.py`) — never plain text.
- [ ] Disconnect calls Intuit's revoke endpoint (`qbo_client.revoke_connection`) before
      deleting local tokens.
- [ ] Uses Intuit's official "Connect to QuickBooks" button image, hidden once
      connected (`ConnectQBO.jsx`).
- [ ] Production redirect URI is a real SaaS domain, not `localhost` or an IP.

Still manual / business-side, not something this codebase can verify for you:

- [ ] App listing content — description, category, screenshots, support URL, privacy
      policy URL, EULA.
- [ ] A reviewer-accessible sandbox or test company with representative GL data.
- [ ] Read Intuit's technical requirements in full before requesting review — this
      repo covers the OAuth/token/button pieces, not the entire checklist:
      [Technical requirements for apps](https://developer.intuit.com/app/developer/qbo/docs/go-live/publish-app/technical-requirements).
- [ ] [How to publish an app on the QuickBooks App Store](https://help.developer.intuit.com/s/article/How-to-publish-an-application-on-the-QuickBooks-App-Store)
      — submission flow and what Intuit's reviewers check.
- [ ] Budget review time: Intuit's own documentation puts the average technical review
      at ~20 business days, more if issues are found and need remediation.
