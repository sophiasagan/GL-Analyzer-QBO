import { useMemo, useState } from "react";
import * as api from "../api";

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}
function startOfQuarter(date) {
  return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
}
function endOfQuarter(date) {
  return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3 + 3, 0);
}
function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1);
}

const today = new Date();

const PRESETS = [
  { key: "thisMonth", label: "This month", range: () => [startOfMonth(today), today] },
  {
    key: "lastMonth",
    label: "Last month",
    range: () => {
      const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return [startOfMonth(d), endOfMonth(d)];
    },
  },
  { key: "thisQuarter", label: "This quarter", range: () => [startOfQuarter(today), today] },
  {
    key: "lastQuarter",
    label: "Last quarter",
    range: () => {
      const qStart = startOfQuarter(today);
      const d = new Date(qStart.getFullYear(), qStart.getMonth() - 3, 1);
      return [startOfQuarter(d), endOfQuarter(d)];
    },
  },
  { key: "thisYear", label: "This year", range: () => [startOfYear(today), today] },
  { key: "custom", label: "Custom" },
];

export default function DateRangePicker({ realmId, onSyncComplete }) {
  const [presetKey, setPresetKey] = useState("thisMonth");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | pulling | classifying | done
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const [startDate, endDate] = useMemo(() => {
    if (presetKey === "custom") {
      return [customStart, customEnd];
    }
    const preset = PRESETS.find((p) => p.key === presetKey);
    const [start, end] = preset.range();
    return [formatDate(start), formatDate(end)];
  }, [presetKey, customStart, customEnd]);

  const canSync = Boolean(startDate && endDate && startDate <= endDate) && phase === "idle";

  const handlePull = async () => {
    setError(null);
    setResult(null);
    setPhase("pulling");

    // The backend runs the whole sync as a single blocking call with no
    // progress stream, so this timer simulates the two-phase indicator
    // rather than reflecting real server-side progress.
    const classifyingTimer = setTimeout(() => setPhase("classifying"), 1400);

    try {
      const syncResult = await api.sync(realmId, { startDate, endDate });
      setResult(syncResult);
      setPhase("done");
    } catch (err) {
      setError(err.message || "Sync failed");
      setPhase("idle");
    } finally {
      clearTimeout(classifyingTimer);
    }
  };

  const isSyncing = phase === "pulling" || phase === "classifying";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Choose a fiscal period</h2>
        <p className="mt-1 text-sm text-gray-500">
          Select a date range to pull and classify the general ledger for.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => setPresetKey(preset.key)}
            disabled={isSyncing}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
              presetKey === preset.key
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:text-blue-700"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {presetKey === "custom" && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex flex-col text-sm text-gray-600">
            Start date
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              disabled={isSyncing}
              className="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>
          <label className="flex flex-col text-sm text-gray-600">
            End date
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              disabled={isSyncing}
              className="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>
        </div>
      )}

      {presetKey !== "custom" && (
        <p className="text-sm text-gray-500">
          {startDate} &rarr; {endDate}
        </p>
      )}

      <button
        type="button"
        onClick={handlePull}
        disabled={!canSync}
        className="w-fit rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Pull GL from QuickBooks
      </button>

      {isSyncing && (
        <div className="flex items-center gap-3 rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600"
            aria-hidden="true"
          />
          {phase === "pulling" ? "Pulling accounts and transactions from QuickBooks…" : "Classifying rows…"}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {phase === "done" && result && (
        <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white px-5 py-4 shadow-sm">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xl font-semibold tabular-nums text-gray-900">{result.row_count}</p>
              <p className="text-xs text-gray-500">Total rows</p>
            </div>
            <div>
              <p className="text-xl font-semibold tabular-nums text-gray-900">{result.rules_classified}</p>
              <p className="text-xs text-gray-500">Via rules</p>
            </div>
            <div>
              <p className="text-xl font-semibold tabular-nums text-gray-900">{result.ai_fallback_count}</p>
              <p className="text-xs text-gray-500">Via AI</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSyncComplete(result)}
            className="w-fit self-end rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            View results &rarr;
          </button>
        </div>
      )}
    </div>
  );
}
