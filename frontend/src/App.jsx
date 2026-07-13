import { useEffect, useState } from "react";
import * as api from "./api";
import ConnectQBO from "./components/ConnectQBO";
import DateRangePicker from "./components/DateRangePicker";
import GLGrid from "./components/GLGrid";
import SummaryPanel from "./components/SummaryPanel";
import ExportBar from "./components/ExportBar";

const STORAGE_KEY = "gl_analyzer_qbo_connection";

export default function App() {
  const [realmId, setRealmId] = useState(null);
  const [companyName, setCompanyName] = useState("");
  const [rows, setRows] = useState(null); // null = not yet synced this session
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState(null);

  // Read realm_id/company from the OAuth callback redirect, or fall back to
  // a previously connected realm persisted locally so a page refresh
  // doesn't lose the connection.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRealmId = params.get("realm_id");

    if (urlRealmId) {
      const urlCompany = params.get("company") || "";
      setRealmId(urlRealmId);
      setCompanyName(urlCompany);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ realmId: urlRealmId, companyName: urlCompany }));
      window.history.replaceState({}, "", "/");
      return;
    }

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const { realmId: storedRealmId, companyName: storedCompany } = JSON.parse(stored);
        setRealmId(storedRealmId);
        setCompanyName(storedCompany || "");
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  const handleDisconnect = async () => {
    await api.disconnect(realmId);
    localStorage.removeItem(STORAGE_KEY);
    setRealmId(null);
    setCompanyName("");
    setRows(null);
  };

  const handleSyncComplete = async () => {
    setRowsLoading(true);
    setRowsError(null);
    try {
      const fetchedRows = await api.fetchRows(realmId);
      setRows(fetchedRows);
    } catch (err) {
      setRowsError(err.message || "Failed to load ledger rows");
    } finally {
      setRowsLoading(false);
    }
  };

  const handleRowUpdate = async (rowId, edits) => {
    const updated = await api.patchRow(realmId, rowId, edits);
    setRows((prev) => prev.map((row) => (row.rowId === rowId ? { ...updated, rowId } : row)));
  };

  const handleSyncAgain = () => {
    setRows(null);
  };

  const stage = !realmId ? "connect" : rows === null ? "sync" : "review";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <span className="text-lg font-semibold text-gray-900">GL Analyzer for QuickBooks</span>
          {realmId && (
            <ConnectQBO isConnected companyName={companyName} onDisconnect={handleDisconnect} compact />
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {stage === "connect" && <ConnectQBO isConnected={false} />}

        {stage === "sync" && (
          <>
            <DateRangePicker realmId={realmId} onSyncComplete={handleSyncComplete} />
            {rowsLoading && <p className="mt-4 text-center text-sm text-gray-500">Loading ledger rows…</p>}
            {rowsError && <p className="mt-4 text-center text-sm text-red-600">{rowsError}</p>}
          </>
        )}

        {stage === "review" && (
          <div className="flex flex-col gap-6">
            <SummaryPanel rows={rows} />
            <GLGrid rows={rows} onRowUpdate={handleRowUpdate} />
            <ExportBar realmId={realmId} onSyncAgain={handleSyncAgain} />
          </div>
        )}
      </main>
    </div>
  );
}
