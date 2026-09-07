/**
 * Message protocol between popup, service worker, and content script (Task 1).
 * One frozen vocabulary so both sides fail loudly instead of drifting apart.
 */

/** @typedef {"PING" | "SCRAPE_START" | "SCRAPE_PROGRESS" | "SCRAPE_DONE" | "SCRAPE_ERROR"} MessageType */

/**
 * @typedef {Object} Message
 * @property {MessageType} type
 * @property {Record<string, unknown>} payload
 */

export const MESSAGE_TYPES = Object.freeze({
	PING: "PING",
	SCRAPE_START: "SCRAPE_START",
	SCRAPE_PROGRESS: "SCRAPE_PROGRESS",
	SCRAPE_DONE: "SCRAPE_DONE",
	SCRAPE_ERROR: "SCRAPE_ERROR",
});

/**
 * @param {string} type Must be a known MESSAGE_TYPES value.
 * @param {Record<string, unknown>} [payload]
 * @returns {Message}
 */
export function createMessage(type, payload = {}) {
	if (!Object.hasOwn(MESSAGE_TYPES, type)) {
		throw new Error(`Unknown message type: ${type}`);
	}
	return { type: /** @type {MessageType} */ (type), payload };
}

/**
 * @param {unknown} value
 * @returns {value is Message}
 */
export function isMessage(value) {
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
