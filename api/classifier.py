"""Rules engine: QBO AccountType -> Debit/Credit + asset type, with AI fallback flag."""

from datetime import date, datetime
from typing import Optional

from .schemas import EnrichedGLRow

# AccountType -> (normal_balance, asset_type)
ACCOUNT_TYPE_MAP: dict[str, tuple[str, str]] = {
    # Assets — normal balance Debit
    "Bank": ("Debit", "Asset"),
    "Other Current Asset": ("Debit", "Asset"),
    "Fixed Asset": ("Debit", "Asset"),
    "Other Asset": ("Debit", "Asset"),
    "Accounts Receivable": ("Debit", "Asset"),
    # Liabilities — normal balance Credit
    "Accounts Payable": ("Credit", "Liability"),
    "Credit Card": ("Credit", "Liability"),
    "Other Current Liability": ("Credit", "Liability"),
    "Long Term Liability": ("Credit", "Liability"),
    # Equity — normal balance Credit
    "Equity": ("Credit", "Equity"),
    # Revenue — normal balance Credit
    "Income": ("Credit", "Revenue"),
    "Other Income": ("Credit", "Revenue"),
    # Expenses — normal balance Debit
    "Expense": ("Debit", "Expense"),
    "Other Expense": ("Debit", "Expense"),
    "Cost of Goods Sold": ("Debit", "Expense"),
}

_OPPOSITE = {"Debit": "Credit", "Credit": "Debit"}


def _to_float(amount) -> float:
    try:
        return float(amount)
    except (TypeError, ValueError):
        return 0.0


def _extract_year(date_value) -> Optional[int]:
    if not date_value:
        return None
    if isinstance(date_value, (date, datetime)):
        return date_value.year
    try:
        return datetime.strptime(str(date_value)[:10], "%Y-%m-%d").year
    except ValueError:
        return None


def classify_row(gl_row: dict, account_map: dict) -> EnrichedGLRow:
    account = account_map.get(gl_row.get("account_id"))
    account_type = account.get("AccountType") if account else None
    mapping = ACCOUNT_TYPE_MAP.get(account_type) if account_type else None

    if account is not None and mapping is not None:
        normal_balance, asset_type = mapping
        amount = _to_float(gl_row.get("amount"))
        debit_credit = normal_balance if amount > 0 else _OPPOSITE[normal_balance]
        confidence = 0.99
        needs_ai = False
    else:
        debit_credit = "Unknown"
        asset_type = "Unknown"
        confidence = 0.0
        needs_ai = True

    return EnrichedGLRow(
        **gl_row,
        debit_credit=debit_credit,
        asset_type=asset_type,
        confidence=confidence,
        needs_ai=needs_ai,
        year=_extract_year(gl_row.get("date")),
        account_type=account_type,
    )


def classify_ledger(gl_rows: list[dict], coa_list: list[dict]) -> list[EnrichedGLRow]:
    account_map = {account["Id"]: account for account in coa_list if account.get("Id") is not None}
    return [classify_row(row, account_map) for row in gl_rows]
