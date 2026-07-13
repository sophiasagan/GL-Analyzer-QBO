"""Intuit QuickBooks Online OAuth 2.0 client: authorize, exchange, refresh, revoke,
and Accounting API access (chart of accounts, General Ledger report)."""

import asyncio
import base64
import calendar
import os
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from typing import Optional, Union
from urllib.parse import urlencode

import httpx

from . import token_store

AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2"
TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke"
SCOPE = "com.intuit.quickbooks.accounting"

# Refresh proactively once the access token is this close to expiring.
REFRESH_MARGIN = timedelta(minutes=5)

# QBO allows 500 requests/min per realm; back off with jitter-free exponential
# delay (honoring Retry-After when present) on 429s.
MAX_RETRIES = 5
BASE_BACKOFF_SECONDS = 1.0

ACCOUNTS_CACHE_TTL = timedelta(minutes=30)
_accounts_cache: dict[str, tuple[datetime, list[dict]]] = {}

# Maps GeneralLedger report ColType -> flat row key.
GL_COLUMN_TYPE_MAP = {
    "tx_date": "date",
    "txn_type": "transaction_type",
    "doc_num": "doc_num",
    "name": "name",
    "memo": "memo",
    "split_acc": "split",
    "amount": "amount",
}


@lru_cache(maxsize=1)
def _get_credentials() -> tuple[str, str, str]:
    return (
        os.environ["QBO_CLIENT_ID"],
        os.environ["QBO_CLIENT_SECRET"],
        os.environ["QBO_REDIRECT_URI"],
    )


@lru_cache(maxsize=1)
def _get_api_base_url() -> str:
    return os.environ.get("QBO_API_BASE_URL", "https://quickbooks.api.intuit.com")


def _basic_auth_header() -> dict:
    client_id, client_secret, _ = _get_credentials()
    encoded = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    return {"Authorization": f"Basic {encoded}"}


def get_auth_url(state: str) -> str:
    client_id, _, redirect_uri = _get_credentials()
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "state": state,
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


async def _post_token_request(data: dict) -> dict:
    headers = {
        **_basic_auth_header(),
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    async with httpx.AsyncClient() as client:
        response = await client.post(TOKEN_URL, data=data, headers=headers)
    response.raise_for_status()
    return response.json()


async def exchange_code(auth_code: str, realm_id: str) -> dict:
    _, _, redirect_uri = _get_credentials()
    payload = await _post_token_request(
        {
            "grant_type": "authorization_code",
            "code": auth_code,
            "redirect_uri": redirect_uri,
        }
    )
    expiry = datetime.now(timezone.utc) + timedelta(seconds=payload["expires_in"])
    await token_store.save_tokens(
        realm_id=realm_id,
        access_token=payload["access_token"],
        refresh_token=payload["refresh_token"],
        expiry=expiry,
        company_name=None,
    )
    return payload


async def refresh_access_token(realm_id: str) -> str:
    tokens = await token_store.get_tokens(realm_id)
    if tokens is None:
        raise ValueError(f"No stored QBO tokens for realm_id={realm_id}")

    now = datetime.now(timezone.utc)
    expiry = tokens["token_expiry"]
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)

    if expiry - now > REFRESH_MARGIN:
        return tokens["access_token"]

    payload = await _post_token_request(
        {
            "grant_type": "refresh_token",
            "refresh_token": tokens["refresh_token"],
        }
    )
    new_expiry = now + timedelta(seconds=payload["expires_in"])
    await token_store.save_tokens(
        realm_id=realm_id,
        access_token=payload["access_token"],
        # Intuit rotates refresh tokens every 24-26 hrs and invalidates the old
        # one immediately — always persist the new one returned here.
        refresh_token=payload["refresh_token"],
        expiry=new_expiry,
        company_name=tokens["company_name"],
    )
    return payload["access_token"]


async def revoke_connection(realm_id: str) -> None:
    tokens = await token_store.get_tokens(realm_id)
    if tokens is None:
        return

    headers = {
        **_basic_auth_header(),
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient() as client:
        response = await client.post(
            REVOKE_URL,
            json={"token": tokens["refresh_token"]},
            headers=headers,
        )
    response.raise_for_status()

    await token_store.delete_tokens(realm_id)


async def get_valid_token(realm_id: str) -> str:
    return await refresh_access_token(realm_id)


async def _request_with_backoff(method: str, url: str, **kwargs) -> httpx.Response:
    async with httpx.AsyncClient() as client:
        for attempt in range(MAX_RETRIES + 1):
            response = await client.request(method, url, **kwargs)
            if response.status_code != 429:
                return response
            if attempt == MAX_RETRIES:
                return response
            retry_after = response.headers.get("Retry-After")
            delay = float(retry_after) if retry_after else BASE_BACKOFF_SECONDS * (2**attempt)
            await asyncio.sleep(delay)
    return response


async def get_chart_of_accounts(realm_id: str) -> list[dict]:
    cached = _accounts_cache.get(realm_id)
    if cached is not None:
        cached_at, accounts = cached
        if datetime.now(timezone.utc) - cached_at < ACCOUNTS_CACHE_TTL:
            return accounts

    access_token = await get_valid_token(realm_id)
    url = f"{_get_api_base_url()}/v3/company/{realm_id}/query"
    query = "SELECT * FROM Account WHERE Active = true MAXRESULTS 1000"
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}

    response = await _request_with_backoff("GET", url, params={"query": query}, headers=headers)
    response.raise_for_status()

    raw_accounts = response.json().get("QueryResponse", {}).get("Account", [])
    accounts = [
        {
            "Id": account.get("Id"),
            "Name": account.get("Name"),
            "AcctNum": account.get("AcctNum"),
            "AccountType": account.get("AccountType"),
            "AccountSubType": account.get("AccountSubType"),
            "Classification": account.get("Classification"),
            "Active": account.get("Active"),
        }
        for account in raw_accounts
    ]
    _accounts_cache[realm_id] = (datetime.now(timezone.utc), accounts)
    return accounts


def _coerce_date(value: Union[str, date, datetime]) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.strptime(value, "%Y-%m-%d").date()


def _add_months(d: date, months: int) -> date:
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _split_into_quarters(start: date, end: date) -> list[tuple[date, date]]:
    chunks: list[tuple[date, date]] = []
    chunk_start = start
    while chunk_start <= end:
        chunk_end = min(_add_months(chunk_start, 3) - timedelta(days=1), end)
        chunks.append((chunk_start, chunk_end))
        chunk_start = chunk_end + timedelta(days=1)
    return chunks


def _split_date_range_for_retry(start: date, end: date) -> list[tuple[date, date]]:
    quarters = _split_into_quarters(start, end)
    if len(quarters) > 1:
        return quarters
    # Already quarter-sized (or smaller) and still too large — bisect it.
    mid = start + timedelta(days=(end - start).days // 2)
    return [(start, mid), (mid + timedelta(days=1), end)]


def _is_cell_limit_error(response: httpx.Response) -> bool:
    body = response.text.lower()
    return "cell" in body and ("limit" in body or "exceed" in body)


def _build_gl_column_map(report: dict) -> dict[int, str]:
    columns = report.get("Columns", {}).get("Column", [])
    return {
        index: GL_COLUMN_TYPE_MAP[column["ColType"]]
        for index, column in enumerate(columns)
        if column.get("ColType") in GL_COLUMN_TYPE_MAP
    }


def _parse_gl_rows(
    row_list: list[dict],
    column_map: dict[int, str],
    account_id: Optional[str],
    account_name: Optional[str],
    out: list[dict],
) -> None:
    for row in row_list:
        row_type = row.get("type")
        if row_type == "Section":
            header_col_data = row.get("Header", {}).get("ColData", [])
            section_account_id = header_col_data[0].get("id") if header_col_data else None
            section_account_name = header_col_data[0].get("value") if header_col_data else None
            nested_rows = row.get("Rows", {}).get("Row", [])
            _parse_gl_rows(
                nested_rows,
                column_map,
                section_account_id or account_id,
                section_account_name or account_name,
                out,
            )
        elif row_type == "Data":
            col_data = row.get("ColData", [])
            flat = {key: None for key in GL_COLUMN_TYPE_MAP.values()}
            for index, cell in enumerate(col_data):
                key = column_map.get(index)
                if key:
                    flat[key] = cell.get("value")
            flat["account_id"] = account_id
            flat["account_name"] = account_name
            out.append(flat)


def _parse_general_ledger_report(report: dict) -> list[dict]:
    column_map = _build_gl_column_map(report)
    rows: list[dict] = []
    _parse_gl_rows(report.get("Rows", {}).get("Row", []), column_map, None, None, rows)
    return rows


async def _fetch_general_ledger_range(realm_id: str, start: date, end: date) -> list[dict]:
    access_token = await get_valid_token(realm_id)
    url = f"{_get_api_base_url()}/v3/company/{realm_id}/reports/GeneralLedger"
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
    params = {
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "minorversion": 75,
    }

    response = await _request_with_backoff("GET", url, params=params, headers=headers)

    if response.status_code == 400 and _is_cell_limit_error(response):
        if start >= end:
            response.raise_for_status()
        rows: list[dict] = []
        for chunk_start, chunk_end in _split_date_range_for_retry(start, end):
            rows.extend(await _fetch_general_ledger_range(realm_id, chunk_start, chunk_end))
        return rows

    response.raise_for_status()
    return _parse_general_ledger_report(response.json())


async def get_general_ledger(
    realm_id: str,
    start_date: Union[str, date, datetime],
    end_date: Union[str, date, datetime],
) -> list[dict]:
    return await _fetch_general_ledger_range(realm_id, _coerce_date(start_date), _coerce_date(end_date))
