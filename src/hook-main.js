/**
 * Network capture hook, MAIN world (Task 7).
 * Classic script on purpose: runs in the page's own world so it can wrap
 * fetch/XHR before site scripts use them. ONLY reads responses and
 * forwards them as DOM events — never modifies requests, never evals,
 * never touches chrome.* (unavailable here by design).
 *
 * Event name "arsip:net" is shared with src/content.js (isolated world
 * hears MAIN-world DOM events). Keep both sides in sync.
 */

const ARSIP_NET_EVENT = "arsip:net";
const MAX_BODY_LENGTH = 500_000;

// Presence marker so the isolated world can report whether this hook
// shares the tab (read by capabilities() in src/content.js).
/** @type {Record<string, unknown>} */ (
	/** @type {unknown} */ (window)
).__arsipHook = "main";

/**
 * @param {string} url
 * @param {number} status
 * @param {string} mime
 * @param {string | null} body Null when not JSON or over the cap.
 * @param {boolean} truncated
 * @param {string} via "fetch" | "xhr".
 */
function emitNetEntry(url, status, mime, body, truncated, via) {
	try {
		window.dispatchEvent(
			new CustomEvent(ARSIP_NET_EVENT, {
				detail: { url, status, mime, body, truncated, via },
			}),
		);
	} catch {
		// Never break the host page when reporting fails.
	}
}

/**
 * @param {string} url
 * @param {number} status
 * @param {string | null} rawMime
 * @param {string} text
 * @param {string} via
 */
function maybeEmit(url, status, rawMime, text, via) {
	const mime = String(rawMime ?? "")
		.split(";")[0]
		.trim();
	if (!mime.includes("json")) {
		emitNetEntry(url, status, mime, null, false, via);
		return;
	}
	if (text.length > MAX_BODY_LENGTH) {
		emitNetEntry(url, status, mime, null, true, via);
		return;
	}
	emitNetEntry(url, status, mime, text, false, via);
}

/**
 * @param {unknown} input fetch() first argument.
 * @returns {string}
 */
function urlOf(input) {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	if (input && typeof input === "object" && "url" in input) {
		return String(input.url);
	}
	return "";
}

(function wrapFetch() {
	if (typeof window.fetch !== "function") {
		return;
	}
	const originalFetch = window.fetch.bind(window);
	window.fetch = async (input, init) => {
		const response = await originalFetch(input, init);
		try {
			const clone = response.clone();
			const text = await clone.text();
			maybeEmit(
				urlOf(input),
				clone.status,
				clone.headers.get("Content-Type"),
				text,
				"fetch",
			);
		} catch {
			// A failed read must not break the original response.
		}
		return response;
	};
})();

(function wrapXhr() {
	if (typeof window.XMLHttpRequest !== "function") {
		return;
	}
	const OriginalXhr = window.XMLHttpRequest;
	const staticsSource = /** @type {Record<string, unknown>} */ (
		/** @type {unknown} */ (OriginalXhr)
	);
	function PatchedXhr() {
		const xhr = new OriginalXhr();
		let url = "";
		const originalOpen = /** @type {(...args: unknown[]) => void} */ (
			xhr.open.bind(xhr)
		);
		xhr.open = /** @type {XMLHttpRequest["open"]} */ (
			(method, requestUrl, ...rest) => {
				url = String(requestUrl ?? "");
				return originalOpen(method, requestUrl, ...rest);
			}
		);
		xhr.addEventListener("load", () => {
			try {
				if (xhr.responseType !== "" && xhr.responseType !== "text") {
					return;
				}
				const text =
					typeof xhr.responseText === "string" ? xhr.responseText : "";
				maybeEmit(
					url,
					xhr.status,
					xhr.getResponseHeader("Content-Type"),
					text,
					"xhr",
				);
			} catch {
				// Never break the host page when reporting fails.
			}
		});
		return xhr;
	}
	PatchedXhr.prototype = OriginalXhr.prototype;
	const staticsTarget = /** @type {Record<string, unknown>} */ (
		/** @type {unknown} */ (PatchedXhr)
	);
	for (const key of [
		"UNSENT",
		"OPENED",
		"HEADERS_RECEIVED",
		"LOADING",
		"DONE",
	]) {
		staticsTarget[key] = staticsSource[key];
	}
	window.XMLHttpRequest = /** @type {typeof XMLHttpRequest} */ (
		/** @type {unknown} */ (PatchedXhr)
	);
})();
