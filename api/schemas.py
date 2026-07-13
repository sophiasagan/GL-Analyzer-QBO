"""Pydantic request/response schemas for the GL analyzer API."""

from typing import Optional

from pydantic import BaseModel


class GLRow(BaseModel):
    date: Optional[str] = None
    transaction_type: Optional[str] = None
    doc_num: Optional[str] = None
    name: Optional[str] = None
    memo: Optional[str] = None
    split: Optional[str] = None
    amount: Optional[float] = None
    account_id: Optional[str] = None
    account_name: Optional[str] = None


class EnrichedGLRow(GLRow):
    debit_credit: str
    asset_type: str
    confidence: float
    needs_ai: bool
    year: Optional[int] = None
    account_type: Optional[str] = None
    pass_number: int = 1
    manually_edited: bool = False


class SyncResult(BaseModel):
    realm_id: str
    row_count: int
    rules_classified: int
    ai_fallback_count: int
    total_debits: float
    total_credits: float
    net_balance: float
    asset_type_breakdown: dict[str, float]
    year_breakdown: dict[int, int]
