"""PostgreSQL-backed storage for QBO OAuth tokens, encrypted at rest with Fernet."""

import os
from datetime import datetime
from functools import lru_cache
from typing import Optional

import asyncpg
from cryptography.fernet import Fernet

# Schema is owned by Alembic (see migrations/versions/) — run
# `alembic upgrade head` before the app connects to a fresh database.
_pool: Optional[asyncpg.Pool] = None


@lru_cache(maxsize=1)
def _get_fernet() -> Fernet:
    key = os.environ["FERNET_KEY"]
    return Fernet(key.encode())


def _encrypt(value: str) -> str:
    return _get_fernet().encrypt(value.encode()).decode()


def _decrypt(value: str) -> str:
    return _get_fernet().decrypt(value.encode()).decode()


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=os.environ["DATABASE_URL"],
            min_size=1,
            max_size=5,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def save_tokens(
    realm_id: str,
    access_token: str,
    refresh_token: str,
    expiry: datetime,
    company_name: str,
) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO qbo_tokens (
                realm_id, access_token, refresh_token, token_expiry,
                company_name, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, now(), now())
            ON CONFLICT (realm_id) DO UPDATE SET
                access_token  = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                token_expiry  = EXCLUDED.token_expiry,
                company_name  = EXCLUDED.company_name,
                updated_at    = now()
            """,
            realm_id,
            _encrypt(access_token),
            _encrypt(refresh_token),
            expiry,
            company_name,
        )


async def get_tokens(realm_id: str) -> Optional[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT realm_id, access_token, refresh_token, token_expiry,
                   company_name, created_at, updated_at
            FROM qbo_tokens
            WHERE realm_id = $1
            """,
            realm_id,
        )
    if row is None:
        return None
    return {
        "realm_id": row["realm_id"],
        "access_token": _decrypt(row["access_token"]),
        "refresh_token": _decrypt(row["refresh_token"]),
        "token_expiry": row["token_expiry"],
        "company_name": row["company_name"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


async def delete_tokens(realm_id: str) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM qbo_tokens WHERE realm_id = $1", realm_id)


async def list_realms() -> list[str]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT realm_id FROM qbo_tokens")
    return [row["realm_id"] for row in rows]
