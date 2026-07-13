gl_analyzer_qbo/
├── api/
│   ├── main.py               # FastAPI app — OAuth routes, sync, export
│   ├── schemas.py            # Pydantic: QBOToken, GLRow, EnrichedGLRow, SyncResult
│   ├── qbo_client.py         # QBO API client: OAuth flow, token refresh, GL pull
│   ├── classifier.py         # Rules engine: AccountType → Debit/Credit + asset type
│   ├── ai_fallback.py        # Claude — only for rows classifier cannot resolve
│   ├── token_store.py        # PostgreSQL token storage with encryption
│   └── exporter.py           # JSON and CSV export
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── ConnectQBO.jsx         # OAuth connect button + connection status
│   │   │   ├── DateRangePicker.jsx    # Fiscal period selector
│   │   │   ├── GLGrid.jsx             # Editable enriched GL table
│   │   │   ├── SummaryPanel.jsx       # Debit/Credit totals + asset breakdown
│   │   │   └── ExportBar.jsx          # JSON + CSV download buttons
│   │   └── api.js
│   └── package.json
├── migrations/             # Alembic DB migrations for token store
├── requirements.txt
├── railway.json
├── .env.example
└── README.md


# gl_analyzer_qbo — Claude Code Context

## Project
QBO-connected GL analyzer: OAuth 2.0 → pull GL from QuickBooks → rules classify
→ Claude fallback for <5% ambiguous rows → editable grid → export.
Target: QuickBooks App Store listing (US first).

## Commands
- Run API:        uvicorn api.main:app --reload --port 8000
- Run frontend:   cd frontend && npm run dev
- DB migrations:  alembic upgrade head
- Local OAuth:    use ngrok for HTTPS redirect URI (Intuit requirement)
- Deploy:         railway up

## Classification strategy
- Primary: rules engine on QBO AccountType — covers ~95% of rows, zero AI cost
- Fallback: Claude for rows where needs_ai=True (missing/unknown AccountType)
- Typical AI usage: <1 Claude call per 1,000-row sync, cost <$0.01

## Token handling
- Access tokens expire every 60 minutes — always call get_valid_token()
- Refresh tokens rotate every 24-26 hrs — ALWAYS save the new token returned
- Tokens stored encrypted (Fernet) in PostgreSQL — never plain text

## App Store requirements to keep in mind
- Never store tokens in plain text
- Disconnect must call the Intuit revoke endpoint
- Use Intuit official button assets for Connect to QuickBooks
- Production redirect URI must be a valid SaaS domain
