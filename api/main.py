"""FastAPI app entry point: QBO OAuth routes, sync, export."""

import os
import secrets
from typing import Literal, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

from . import ai_fallback, classifier, exporter, qbo_client, token_store
from .schemas import EnrichedGLRow, SyncResult

# In Railway, real env vars are already set and this is a no-op — .env
# won't exist in the deployed image, and load_dotenv() doesn't error when
# there's nothing to load.
load_dotenv()

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")

app = FastAPI(title="gl_analyzer_qbo")

app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ["SESSION_SECRET"],
    same_site="lax",
    https_only=True,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# realm_id -> most recently synced enriched GL rows
_ledger_store: dict[str, list[EnrichedGLRow]] = {}


class SyncRequest(BaseModel):
    start_date: str
    end_date: str


class RowEdit(BaseModel):
    debit_credit: Optional[str] = None
    year: Optional[int] = None
    asset_type: Optional[str] = None


def _get_ledger(realm_id: str) -> list[EnrichedGLRow]:
    rows = _ledger_store.get(realm_id)
    if rows is None:
        raise HTTPException(status_code=404, detail=f"No synced ledger for realm_id={realm_id}")
    return rows


@app.get("/connect")
async def connect(request: Request):
    state = secrets.token_urlsafe(32)
    request.session["oauth_state"] = state
    return RedirectResponse(qbo_client.get_auth_url(state))


@app.get("/callback")
async def callback(
    request: Request,
    code: str,
    state: str,
    realm_id: str = Query(..., alias="realmId"),
):
    expected_state = request.session.pop("oauth_state", None)
    if not expected_state or not secrets.compare_digest(expected_state, state):
        raise HTTPException(status_code=400, detail="Invalid or missing CSRF state")

    await qbo_client.exchange_code(auth_code=code, realm_id=realm_id)
    tokens = await token_store.get_tokens(realm_id)
    company_name = (tokens or {}).get("company_name") or ""

    return RedirectResponse(f"{FRONTEND_URL}/connected?realm_id={realm_id}&company={company_name}")


@app.delete("/disconnect/{realm_id}")
async def disconnect(realm_id: str):
    await qbo_client.revoke_connection(realm_id)
    _ledger_store.pop(realm_id, None)
    return {"disconnected": True}


def _build_sync_result(realm_id: str, rows: list[EnrichedGLRow]) -> SyncResult:
    rules_classified = sum(1 for row in rows if row.pass_number == 1 and not row.needs_ai)
    ai_fallback_count = sum(1 for row in rows if row.pass_number == 2)

    total_debits = sum(abs(row.amount) for row in rows if row.debit_credit == "Debit" and row.amount is not None)
    total_credits = sum(abs(row.amount) for row in rows if row.debit_credit == "Credit" and row.amount is not None)

    asset_type_breakdown: dict[str, float] = {}
    year_breakdown: dict[int, int] = {}
    for row in rows:
        if row.amount is not None:
            asset_type_breakdown[row.asset_type] = asset_type_breakdown.get(row.asset_type, 0.0) + abs(row.amount)
        if row.year is not None:
            year_breakdown[row.year] = year_breakdown.get(row.year, 0) + 1

    return SyncResult(
        realm_id=realm_id,
        row_count=len(rows),
        rules_classified=rules_classified,
        ai_fallback_count=ai_fallback_count,
        total_debits=total_debits,
        total_credits=total_credits,
        net_balance=total_debits - total_credits,
        asset_type_breakdown=asset_type_breakdown,
        year_breakdown=year_breakdown,
    )


@app.post("/sync/{realm_id}", response_model=SyncResult)
async def sync(realm_id: str, body: SyncRequest):
    await qbo_client.get_valid_token(realm_id)

    coa = await qbo_client.get_chart_of_accounts(realm_id)
    gl_rows = await qbo_client.get_general_ledger(realm_id, body.start_date, body.end_date)

    enriched = classifier.classify_ledger(gl_rows, coa)

    ai_rows = [row for row in enriched if row.needs_ai]
    if ai_rows:
        ai_fallback.enrich_fallback_rows(ai_rows)

    _ledger_store[realm_id] = enriched

    return _build_sync_result(realm_id, enriched)


@app.patch("/row/{realm_id}/{row_id}", response_model=EnrichedGLRow)
async def edit_row(realm_id: str, row_id: int, edit: RowEdit):
    rows = _get_ledger(realm_id)
    if row_id < 0 or row_id >= len(rows):
        raise HTTPException(status_code=404, detail=f"No row {row_id} for realm_id={realm_id}")

    row = rows[row_id]
    if edit.debit_credit is not None:
        row.debit_credit = edit.debit_credit
    if edit.year is not None:
        row.year = edit.year
    if edit.asset_type is not None:
        row.asset_type = edit.asset_type
    row.manually_edited = True

    return row


@app.get("/export/{realm_id}")
async def export(realm_id: str, format: Literal["json", "csv"] = "json"):
    rows = _get_ledger(realm_id)

    if format == "csv":
        content = exporter.to_csv(rows)
        media_type = "text/csv"
    else:
        content = exporter.to_json(rows)
        media_type = "application/json"

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="gl_{realm_id}.{format}"'},
    )


@app.get("/health")
async def health():
    qbo_status = "unreachable"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get("https://developer.api.intuit.com/.well-known/openid_configuration")
        if response.status_code < 500:
            qbo_status = "reachable"
    except httpx.HTTPError:
        pass

    return {"status": "ok", "qbo_api": qbo_status, "model": ai_fallback.MODEL}
