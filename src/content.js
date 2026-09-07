/**
 * Runs in the tab the user has open, so DOM reads and media fetches
 * inherit the login session. Only this file may touch the X DOM
 * (via `x-adapter.js` from Task 2 onward).
 *
 * Classic script on purpose: Chrome content scripts cannot use static
 * `import`, so the message vocabulary below mirrors `messaging.js`
 * (canonical for popup/worker, which run as modules). A test pins
 * the two copies together — update both or the suite fails.
 */

/** Keep in sync with MESSAGE_TYPES in `messaging.js`. */
const MESSAGE_TYPES = Object.freeze({
	PING: "PING",
	SCRAPE_START: "SCRAPE_START",
	SCRAPE_PROGRESS: "SCRAPE_PROGRESS",
	SCRAPE_DONE: "SCRAPE_DONE",
	SCRAPE_ERROR: "SCRAPE_ERROR",
});

/**
 * @param {string} type
 * @param {Record<string, unknown>} [payload]
 * @returns {{ type: string, payload: Record<string, unknown> }}
 */
function reply(type, payload = {}) {
	return { type, payload };
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isKnownMessage(value) {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const { type, payload } =
		/** @type {{ type?: unknown, payload?: unknown }} */ (value);
	return (
		typeof type === "string" &&
		Object.hasOwn(MESSAGE_TYPES, type) &&
		typeof payload === "object" &&
		payload !== null
	);
}

chrome.runtime.onMessage.addListener((raw, _sender, respond) => {
	if (!isKnownMessage(raw)) {
		respond(reply(MESSAGE_TYPES.SCRAPE_ERROR, { code: "BAD_MESSAGE" }));
		return false;
	}
	if (raw.type === MESSAGE_TYPES.PING) {
		respond(reply(MESSAGE_TYPES.PING, { connected: true }));
		return false;
	}
	respond(
		reply(MESSAGE_TYPES.SCRAPE_ERROR, {
			code: "NOT_IMPLEMENTED",
			detail: "Scraping lands in Task 2",
		}),
	);
	return false;
});
