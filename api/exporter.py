"""JSON and CSV export for enriched GL rows."""

import csv
import io
import json

from .schemas import EnrichedGLRow

CSV_FIELDS = [
    "date",
    "transaction_type",
    "doc_num",
    "name",
    "memo",
    "split",
    "amount",
    "account_id",
    "account_name",
    "account_type",
    "debit_credit",
    "asset_type",
    "confidence",
    "needs_ai",
    "year",
    "pass_number",
    "manually_edited",
]


def to_json(rows: list[EnrichedGLRow]) -> str:
    return json.dumps([row.model_dump() for row in rows], indent=2, default=str)


def to_csv(rows: list[EnrichedGLRow]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_FIELDS)
    writer.writeheader()
    for row in rows:
        writer.writerow(row.model_dump())
    return buffer.getvalue()
