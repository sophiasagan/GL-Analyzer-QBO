import { useMemo } from "react";
import { currencyFormatter } from "../format";

const ASSET_TYPES = ["Asset", "Liability", "Equity", "Revenue", "Expense"];

function useSummary(rows) {
  return useMemo(() => {
    let totalDebits = 0;
    let totalCredits = 0;
    let rulesCount = 0;
    let aiCount = 0;
    const breakdown = {};

    for (const row of rows) {
      const amount = row.amount != null ? Math.abs(row.amount) : 0;
      if (row.debit_credit === "Debit") totalDebits += amount;
      if (row.debit_credit === "Credit") totalCredits += amount;
      if (row.pass_number === 2) aiCount += 1;
      else if (!row.needs_ai) rulesCount += 1;
      breakdown[row.asset_type] = (breakdown[row.asset_type] || 0) + amount;
    }

    // Fixed chart-of-accounts order first, then any other category
    // (e.g. "Unknown" on still-unresolved rows) appended at the end.
    const orderedTypes = [...ASSET_TYPES, ...Object.keys(breakdown).filter((t) => !ASSET_TYPES.includes(t))];
    const assetBreakdown = orderedTypes
      .filter((type) => breakdown[type])
      .map((type) => ({ type, amount: breakdown[type] }));

    return {
      totalDebits,
      totalCredits,
      netBalance: totalDebits - totalCredits,
      rulesCount,
      aiCount,
      assetBreakdown,
    };
  }, [rows]);
}

function StatCard({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone || "text-gray-900"}`}>{value}</p>
    </div>
  );
}

function AssetTypeChart({ data }) {
  if (data.length === 0) {
    return null;
  }

  const max = Math.max(...data.map((d) => d.amount));

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-5 py-4 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-900">Asset type breakdown</h3>
      <div className="mt-4 flex flex-col gap-3">
        {data.map((d) => (
          <div key={d.type} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-xs font-medium text-gray-600">{d.type}</span>
            <div className="h-4 flex-1 rounded-r bg-gray-100">
              <div
                className="h-4 rounded-r bg-blue-600"
                style={{ width: `${max > 0 ? (d.amount / max) * 100 : 0}%` }}
              />
            </div>
            <span className="w-24 shrink-0 text-right text-xs tabular-nums text-gray-700">
              {currencyFormatter.format(d.amount)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SummaryPanel({ rows }) {
  const { totalDebits, totalCredits, netBalance, rulesCount, aiCount, assetBreakdown } = useSummary(rows);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total debits" value={currencyFormatter.format(totalDebits)} />
        <StatCard label="Total credits" value={currencyFormatter.format(totalCredits)} />
        <StatCard label="Net balance" value={currencyFormatter.format(netBalance)} tone="text-blue-700" />
        <StatCard label="Rows via rules" value={rulesCount.toLocaleString()} tone="text-green-700" />
        <StatCard label="Rows via AI" value={aiCount.toLocaleString()} tone="text-amber-700" />
      </div>

      <AssetTypeChart data={assetBreakdown} />
    </div>
  );
}
