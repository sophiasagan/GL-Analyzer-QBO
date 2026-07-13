import { exportUrl } from "../api";

export default function ExportBar({ realmId, onSyncAgain }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-5 py-3 shadow-sm">
      <div className="flex gap-2">
        <a
          href={exportUrl(realmId, "csv")}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-blue-300 hover:text-blue-700"
        >
          Export CSV
        </a>
        <a
          href={exportUrl(realmId, "json")}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-blue-300 hover:text-blue-700"
        >
          Export JSON
        </a>
      </div>
      <button
        type="button"
        onClick={onSyncAgain}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
      >
        Sync again
      </button>
    </div>
  );
}
