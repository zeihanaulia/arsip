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
	SCRAPE_STATUS: "SCRAPE_STATUS",
	SCRAPE_CANCEL: "SCRAPE_CANCEL",
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

/**
 * Cooperative cancel flag, set by SCRAPE_CANCEL between scroll batches.
 * @type {boolean}
 */
let cancelRequested = false;

/**
 * @param {unknown} raw
 * @returns {boolean}
 */
function readAutoScroll(raw) {
	const payload = /** @type {{ payload?: unknown }} */ (raw).payload;
	return (
		typeof payload === "object" &&
		payload !== null &&
		/** @type {{ autoScroll?: unknown }} */ (payload).autoScroll === true
	);
}

/**
 * Fire-and-forget progress report. Failures are swallowed on purpose:
 * the final response still travels through the tabs.sendMessage channel.
 *
 * @param {Record<string, unknown>} stats
 */
function postProgress(stats) {
	try {
		const pending = chrome.runtime.sendMessage(
			reply(MESSAGE_TYPES.SCRAPE_PROGRESS, stats),
		);
		if (pending && typeof pending.catch === "function") {
			pending.catch(() => {});
		}
	} catch {
		// Background unreachable mid-scroll; the final answer still goes out.
	}
}

/**
 * @param {boolean} autoScroll
 * @returns {Promise<{ type: string, payload: Record<string, unknown> }>}
 */
async function runScrape(autoScroll) {
	cancelRequested = false;
	if (autoScroll) {
		const scroller =
			/** @type {{ expandAndScroll?: (...args: unknown[]) => Promise<Record<string, unknown>> } | undefined} */ (
				globalThis.XScroller
			);
		if (scroller && typeof scroller.expandAndScroll === "function") {
			const stats = await scroller.expandAndScroll(
				document,
				{ shouldStop: () => cancelRequested },
				(/** @type {Record<string, unknown>} */ progress) =>
					postProgress({ phase: "expanding", ...progress }),
			);
			postProgress({ phase: "scraping", ...(stats ?? {}) });
		}
	}
	return scrapeSafely();
}
/**
 * @returns {{ tweets: unknown[], url: string }}
 */
function scrapeCurrentPage() {
	const adapter =
		/** @type {{ scrapeRaw?: (doc: Document, url: string) => { tweets: unknown[], url: string } } | undefined } */ (
			globalThis.XAdapter
		);
	if (!adapter || typeof adapter.scrapeRaw !== "function") {
		throw new Error("XAdapter not loaded — reload the extension and the tab");
	}
	return adapter.scrapeRaw(document, location.href);
}

/**
 * Never throws: the background awaits our response, so an uncaught
 * exception here would hang the popup forever.
 *
 * @returns {{ type: string, payload: Record<string, unknown> }}
 */
function scrapeSafely() {
	try {
		const { tweets, url } = scrapeCurrentPage();
		return reply(MESSAGE_TYPES.SCRAPE_DONE, { tweets, sourceUrl: url });
	} catch (error) {
		return reply(MESSAGE_TYPES.SCRAPE_ERROR, {
			code: "SCRAPE_FAILED",
			detail: error instanceof Error ? error.message : "unknown error",
		});
	}
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
	if (raw.type === MESSAGE_TYPES.SCRAPE_CANCEL) {
		cancelRequested = true;
		respond(reply(MESSAGE_TYPES.SCRAPE_DONE, { cancelled: true }));
		return false;
	}
	if (raw.type === MESSAGE_TYPES.SCRAPE_START) {
		runScrape(readAutoScroll(raw)).then(respond);
		return true;
	}
	respond(
		reply(MESSAGE_TYPES.SCRAPE_ERROR, {
			code: "UNSUPPORTED",
			detail:
				"Content script only handles PING, SCRAPE_START and SCRAPE_CANCEL",
		}),
	);
	return false;
});
