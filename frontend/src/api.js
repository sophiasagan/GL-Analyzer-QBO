// Central client for the gl_analyzer_qbo API. Every component talks to the
// backend through these functions rather than calling fetch() directly.

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

async function apiFetch(path, options = {}) {
  const { headers, ...rest } = options;

  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: {
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...rest,
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch {
      // Response body wasn't JSON — fall back to the status text.
    }
    throw new Error(`${response.status}: ${detail}`);
  }

  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json") ? response.json() : response.text();
}

// Full-page navigation target for the "Connect to QuickBooks" button —
// not a fetch call, the backend redirects the browser to Intuit.
export function connectUrl() {
  return `${API_BASE}/connect`;
}

// Download link target for ExportBar — not a fetch call, this triggers the
// browser's native download via the Content-Disposition header.
export function exportUrl(realmId, format) {
  return `${API_BASE}/export/${realmId}?format=${format}`;
}

export function disconnect(realmId) {
  return apiFetch(`/disconnect/${realmId}`, { method: "DELETE" });
}

export function sync(realmId, { startDate, endDate }) {
  return apiFetch(`/sync/${realmId}`, {
    method: "POST",
    body: JSON.stringify({ start_date: startDate, end_date: endDate }),
  });
}

// The backend has no dedicated "list rows" endpoint — /export?format=json
// is reused here since it returns the full enriched row array as a JSON
// response body (the Content-Disposition header only matters for direct
// browser navigation, not for fetch()). Each row is tagged with rowId,
// its index in the backend's in-memory list, which is what PATCH /row
// expects as the row identifier.
export async function fetchRows(realmId) {
  const rows = await apiFetch(`/export/${realmId}?format=json`);
  return rows.map((row, index) => ({ ...row, rowId: index }));
}

export function patchRow(realmId, rowId, edits) {
  return apiFetch(`/row/${realmId}/${rowId}`, {
    method: "PATCH",
    body: JSON.stringify(edits),
  });
}
