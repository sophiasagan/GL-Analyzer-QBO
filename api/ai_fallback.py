"""Claude fallback classifier for GL rows the rules engine could not resolve.

Only rows with needs_ai=True are ever sent here — typically <5% of a sync.
At 5% fallback on a 1,000-row ledger that's ~50 rows per Claude call
(one batch), costing well under $0.01 per sync at current Sonnet pricing.
"""

import json
import logging
from functools import lru_cache
from typing import Optional

import anthropic

from .schemas import EnrichedGLRow

logger = logging.getLogger(__name__)

MODEL = "claude-opus-4-8"
BATCH_SIZE = 50
MAX_TOKENS = 8000

SYSTEM_PROMPT = """
You are an expert accountant. Classify each general ledger row.
These rows could not be classified from standard account type rules —
the account may be a suspense account, a custom account, or have missing metadata.
Use the account name, description, and amount to make your best determination.

For each row return JSON: {row_id, debit_credit (Debit|Credit), asset_type
(Asset|Liability|Equity|Revenue|Expense), confidence (0.0-1.0), reasoning}
Return ONLY a valid JSON array. No explanation outside the array.
"""

_RESPONSE_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "row_id": {"type": "integer"},
            "debit_credit": {"type": "string", "enum": ["Debit", "Credit"]},
            "asset_type": {
                "type": "string",
                "enum": ["Asset", "Liability", "Equity", "Revenue", "Expense"],
            },
            "confidence": {"type": "number"},
            "reasoning": {"type": "string"},
        },
        "required": ["row_id", "debit_credit", "asset_type", "confidence", "reasoning"],
        "additionalProperties": False,
    },
}


@lru_cache(maxsize=1)
def _get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic()


def _row_description(row: EnrichedGLRow) -> str:
    return row.memo or row.name or ""


def _classify_batch(client: anthropic.Anthropic, batch: list[tuple[int, EnrichedGLRow]]) -> dict[int, dict]:
    payload = [
        {
            "row_id": row_id,
            "account_name": row.account_name,
            "account_type": row.account_type,
            "description": _row_description(row),
            "amount": row.amount,
        }
        for row_id, row in batch
    ]

    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        output_config={
            "effort": "low",
            "format": {"type": "json_schema", "schema": _RESPONSE_SCHEMA},
        },
        messages=[{"role": "user", "content": json.dumps(payload)}],
    )

    text = next(block.text for block in response.content if block.type == "text")
    results = json.loads(text)
    return {item["row_id"]: item for item in results}


def enrich_fallback_rows(rows: list[EnrichedGLRow]) -> list[EnrichedGLRow]:
    indexed_rows = list(enumerate(rows))
    client = _get_client()

    for batch_start in range(0, len(indexed_rows), BATCH_SIZE):
        batch = indexed_rows[batch_start : batch_start + BATCH_SIZE]
        try:
            results_by_id = _classify_batch(client, batch)
        except Exception:
            logger.warning(
                "Claude fallback classification failed for a batch of %d rows; leaving as Unknown",
                len(batch),
                exc_info=True,
            )
            continue

        for row_id, row in batch:
            result = results_by_id.get(row_id)
            if result is None:
                continue
            row.debit_credit = result["debit_credit"]
            row.asset_type = result["asset_type"]
            row.confidence = float(result["confidence"])
            row.needs_ai = False
            row.pass_number = 2

    return rows
