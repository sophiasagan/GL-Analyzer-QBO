import { useState } from "react";
import { connectUrl } from "../api";

// Intuit's official "Connect to QuickBooks" button asset — required for
// App Store listing approval. Do not swap for a custom-styled button.
const INTUIT_BUTTON_URL =
  "https://appcenter.intuit.com/Content/IA/intuit-signin-buttons/v1/2x/btn_intuit_us_2x.png";

export default function ConnectQBO({ isConnected, companyName, onDisconnect, compact = false }) {
  const [disconnecting, setDisconnecting] = useState(false);

  const handleConnect = () => {
    window.location.href = connectUrl();
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await onDisconnect();
    } finally {
      setDisconnecting(false);
    }
  };

  if (isConnected) {
    return (
      <div
        className={
          compact
            ? "flex items-center gap-3"
            : "flex min-h-[60vh] flex-col items-center justify-center gap-4"
        }
      >
        <div
          className={
            compact
              ? "flex items-center gap-3 rounded-full border border-gray-200 bg-white px-4 py-1.5 shadow-sm"
              : "flex flex-col items-center gap-3 rounded-lg border border-gray-200 bg-white px-8 py-6 shadow-sm"
          }
        >
          <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
            <span className="h-2 w-2 rounded-full bg-blue-600" aria-hidden="true" />
            {companyName || "QuickBooks Company"}
          </span>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="text-sm font-medium text-gray-400 underline decoration-gray-300 underline-offset-4 hover:text-red-600 disabled:opacity-50"
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">GL Analyzer for QuickBooks</h1>
        <p className="mt-2 max-w-sm text-gray-500">
          Connect your QuickBooks Online company to pull and classify your general ledger.
        </p>
      </div>

      <button type="button" onClick={handleConnect} className="transition hover:opacity-90">
        <img src={INTUIT_BUTTON_URL} alt="Connect to QuickBooks" className="h-auto w-56" />
      </button>
    </div>
  );
}
