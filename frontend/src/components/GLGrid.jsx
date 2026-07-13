import { useEffect, useMemo, useState } from "react";
import { currencyFormatter } from "../format";

const PAGE_SIZE = 50;

const ASSET_TYPES = ["Asset", "Liability", "Equity", "Revenue", "Expense"];

const COLUMNS = [
  { key: "rowId", label: "#" },
  { key: "date", label: "Date" },
  { key: "transaction_type", label: "Type" },
  { key: "doc_num", label: "Doc #" },
  { key: "name", label: "Name / Memo" },
  { key: "account_name", label: "Account" },
  { key: "amount", label: "Amount" },
  { key: "debit_credit", label: "D/C" },
  { key: "year", label: "Year" },
  { key: "asset_type", label: "Asset Type" },
  { key: "pass_number", label: "Source" },
  { key: "manually_edited", label: "Edited" },
];

function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

function rowHighlightClass(row) {
  if (row.needs_ai) return "bg-red-50";
  if (row.pass_number === 2) return "bg-yellow-50";
  return "bg-white";
}

function SortIndicator({ active, direction }) {
  if (!active) return null;
  return (
    <span className="ml-1 text-gray-400" aria-hidden="true">
      {direction === "asc" ? "▲" : "▼"}
    </span>
  );
}

function SourceBadge({ row }) {
  if (row.needs_ai) {
    return (
      <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">Unresolved</span>
    );
  }
  if (row.pass_number === 2) {
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">AI</span>;
  }
  return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Rules</span>;
}

function YearCell({ value, onCommit }) {
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (draft !== "" && !Number.isNaN(parsed) && parsed !== value) {
      onCommit(parsed);
    } else {
      setDraft(value ?? "");
    }
  };

  return (
    <input
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm tabular-nums text-gray-900 hover:border-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  );
}

function DebitCreditSelect({ value, onChange }) {
  const isKnown = value === "Debit" || value === "Credit";
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-md border-0 px-2 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500 ${
        value === "Debit" ? "bg-blue-100 text-blue-800" : value === "Credit" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
      }`}
    >
      {!isKnown && <option value={value}>{value}</option>}
      <option value="Debit">Debit</option>
      <option value="Credit">Credit</option>
    </select>
  );
}

function AssetTypeSelect({ value, onChange }) {
  const isKnown = ASSET_TYPES.includes(value);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
    >
      {!isKnown && <option value={value}>{value}</option>}
      {ASSET_TYPES.map((type) => (
        <option key={type} value={type}>
          {type}
        </option>
      ))}
    </select>
  );
}

export default function GLGrid({ rows, onRowUpdate }) {
  const [sortConfig, setSortConfig] = useState(null);
  const [page, setPage] = useState(1);
  const [editError, setEditError] = useState(null);

  useEffect(() => {
    setPage(1);
  }, [rows.length]);

  const sortedRows = useMemo(() => {
    if (!sortConfig) return rows;
    const sorted = [...rows].sort((a, b) => compareValues(a[sortConfig.key], b[sortConfig.key]));
    return sortConfig.direction === "desc" ? sorted.reverse() : sorted;
  }, [rows, sortConfig]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = sortedRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (!prev || prev.key !== key) return { key, direction: "asc" };
      if (prev.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  };

  const handleEdit = async (rowId, edits) => {
    setEditError(null);
    try {
      await onRowUpdate(rowId, edits);
    } catch (err) {
      setEditError(err.message || "Failed to save edit");
    }
  };

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-500">No rows to display.</p>;
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      {editError && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{editError}</div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-700"
                >
                  {col.label}
                  <SortIndicator active={sortConfig?.key === col.key} direction={sortConfig?.direction} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.rowId} className={`border-b border-gray-100 last:border-0 ${rowHighlightClass(row)}`}>
                <td className="px-3 py-2 text-gray-400 tabular-nums">{row.rowId + 1}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-900 tabular-nums">{row.date || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-700">{row.transaction_type || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-700">{row.doc_num || "—"}</td>
                <td className="max-w-[220px] px-3 py-2">
                  <p className="truncate font-medium text-gray-900">{row.name || "—"}</p>
                  {row.memo && <p className="truncate text-xs text-gray-500">{row.memo}</p>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-700">{row.account_name || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900">
                  {row.amount != null ? currencyFormatter.format(row.amount) : "—"}
                </td>
                <td className="px-3 py-2">
                  <DebitCreditSelect
                    value={row.debit_credit}
                    onChange={(value) => handleEdit(row.rowId, { debit_credit: value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <YearCell value={row.year} onCommit={(value) => handleEdit(row.rowId, { year: value })} />
                </td>
                <td className="px-3 py-2">
                  <AssetTypeSelect
                    value={row.asset_type}
                    onChange={(value) => handleEdit(row.rowId, { asset_type: value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <SourceBadge row={row} />
                </td>
                <td className="px-3 py-2">
                  {row.manually_edited ? (
                    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                      Edited
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm text-gray-600">
        <span>
          Showing {(currentPage - 1) * PAGE_SIZE + 1}
          &ndash;
          {Math.min(currentPage * PAGE_SIZE, sortedRows.length)} of {sortedRows.length} rows
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 disabled:opacity-40"
          >
            Prev
          </button>
          <span className="tabular-nums">
            Page {currentPage} of {pageCount}
          </span>
          <button
            type="button"
            disabled={currentPage >= pageCount}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
