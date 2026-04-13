import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { diag } from "./diagnostics";

// Capture uncaught JS errors. Do NOT log e.message or e.filename —
// those strings commonly embed file paths and other private data.
window.addEventListener("error", (e: ErrorEvent) => {
	diag.jsError(e.error?.constructor?.name ?? "Error", 0);
});

window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
	diag.jsError(e.reason?.constructor?.name ?? "UnhandledRejection", 0);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
