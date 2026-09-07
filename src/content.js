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
	BUILD_ZIP: "BUILD_ZIP",
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
 * @returns {{ autoScroll: boolean, videoMode: string }}
 */
function readScrapeOptions(raw) {
	const payload = /** @type {{ payload?: unknown }} */ (raw).payload;
	const options = /** @type {{ autoScroll?: unknown, videoMode?: unknown }} */ (
		payload ?? {}
	);
	return {
		autoScroll: options.autoScroll === true,
		videoMode:
			options.videoMode === "bundle" ||
			options.videoMode === "separate" ||
			options.videoMode === "posters-only"
				? options.videoMode
				: "bundle",
	};
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
 * @param {string} videoMode "bundle" | "separate" | "posters-only".
 * @returns {Promise<{ type: string, payload: Record<string, unknown> }>}
 */
async function runScrape(autoScroll, videoMode) {
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
	const scraped = scrapeSafely();
	if (scraped.type !== MESSAGE_TYPES.SCRAPE_DONE) {
		return scraped;
	}
	const tweets = /** @type {unknown[]} */ (scraped.payload.tweets ?? []);
	return reply(MESSAGE_TYPES.SCRAPE_DONE, {
		tweets,
		sourceUrl: scraped.payload.sourceUrl ?? "",
		media: await downloadThreadMedia(tweets, videoMode),
	});
}

/** Per-file cap so one video cannot kill the message channel (~21MB). */
const MAX_MEDIA_BASE64_LENGTH = 28_000_000;

/**
 * @param {unknown[]} tweets Raw adapter tweets.
 * @param {string} videoMode "posters-only" skips video bytes (posters stay).
 * @returns {Promise<Record<string, unknown>[]>} One item per inventoried URL.
 */
async function downloadThreadMedia(tweets, videoMode) {
	const items = [];
	for (const rawTweet of tweets ?? []) {
		const tweet = /** @type {{ id?: unknown, media?: unknown }} */ (
			rawTweet ?? {}
		);
		const list = Array.isArray(tweet.media) ? tweet.media : [];
		let index = 0;
		for (const rawEntry of list) {
			index += 1;
			items.push(
				await downloadMediaItem(
					String(tweet.id ?? "unknown"),
					index,
					rawEntry,
					videoMode,
				),
			);
		}
	}
	return items;
}

/**
 * @param {string} tweetId
 * @param {number} index
 * @param {unknown} rawEntry
 * @param {string} videoMode
 * @returns {Promise<Record<string, unknown>>}
 */
async function downloadMediaItem(tweetId, index, rawEntry, videoMode) {
	const entry = /** @type {{ url?: unknown, type?: unknown }} */ (
		rawEntry ?? {}
	);
	const url = typeof entry.url === "string" ? entry.url : "";
	const type = typeof entry.type === "string" ? entry.type : "unknown";
	const base = { tweetId, url, type };
	if (videoMode === "posters-only" && type === "video") {
		return { ...base, unresolved: "skipped-by-mode" };
	}
	const media =
		/** @type {{ isFetchable?: (url: string) => boolean, fetchBytes?: (url: string) => Promise<{ base64: string, mime: string }>, localName?: (tweetId: string, index: number, url: string, mime: string) => string } | undefined} */ (
			globalThis.XMedia
		);
	if (
		!media ||
		typeof media.isFetchable !== "function" ||
		!media.isFetchable(url)
	) {
		return { ...base, unresolved: classifyUnresolved(url) };
	}
	try {
		const fetched = await media.fetchBytes?.(url);
		if (!fetched || fetched.base64.length > MAX_MEDIA_BASE64_LENGTH) {
			return { ...base, unresolved: "too-large" };
		}
		const localPath = media.localName?.(tweetId, index, url, fetched.mime);
		return { ...base, localPath, mime: fetched.mime, base64: fetched.base64 };
	} catch {
		return { ...base, unresolved: "fetch-failed" };
	}
}

/**
 * @param {string} url
 * @returns {string}
 */
function classifyUnresolved(url) {
	if (url === "") {
		return "empty-url";
	}
	if (url.startsWith("blob:")) {
		return "blob-stream";
	}
	if (/\.m3u8($|[?#])/i.test(url)) {
		return "hls-playlist";
	}
	return "unfetchable-scheme";
}

/**
 * @param {unknown} raw
 * @returns {Promise<{ type: string, payload: Record<string, unknown> }>}
 */
async function buildZipReply(raw) {
	try {
		const { buildZip, bytesToBase64, JSZipClass } = requireZipLibraries();
		const envelope = /** @type {{ payload?: { files?: unknown } }} */ (raw);
		const entries = toZipEntries(envelope.payload?.files, (text) =>
			bytesToBase64(new TextEncoder().encode(text)),
		);
		const zipBase64 = await buildZip(entries, JSZipClass);
		return reply(MESSAGE_TYPES.SCRAPE_DONE, { zipBase64 });
	} catch (error) {
		return reply(MESSAGE_TYPES.SCRAPE_ERROR, {
			code: "ZIP_FAILED",
			detail: error instanceof Error ? error.message : "unknown error",
		});
	}
}

/**
 * Grabs the two classic globals ZIP building needs, or throws a
 * reload hint the popup can actually act on.
 *
 * @returns {{ buildZip: (files: { name: string, base64: string }[], JSZipClass: unknown) => Promise<string>, bytesToBase64: (bytes: Uint8Array) => string, JSZipClass: unknown }}
 */
function requireZipLibraries() {
	const media =
		/** @type {{ buildZip?: (files: { name: string, base64: string }[], JSZipClass: unknown) => Promise<string>, bytesToBase64?: (bytes: Uint8Array) => string } | undefined} */ (
			globalThis.XMedia
		);
	const JSZipClass = /** @type {unknown} */ (
		/** @type {{ JSZip?: unknown }} */ (globalThis).JSZip
	);
	if (
		!media ||
		typeof media.buildZip !== "function" ||
		typeof media.bytesToBase64 !== "function" ||
		!JSZipClass
	) {
		throw new Error("zip libraries not loaded — reload the extension");
	}
	return {
		buildZip: media.buildZip,
		bytesToBase64: media.bytesToBase64,
		JSZipClass,
	};
}

/**
 * Normalizes a caller-supplied file list: nameless entries are dropped,
 * inline text is encoded, ready bytes pass through untouched.
 *
 * @param {unknown} files
 * @param {(text: string) => string} encodeText
 * @returns {{ name: string, base64: string }[]}
 */
function toZipEntries(files, encodeText) {
	const entries = [];
	for (const rawFile of Array.isArray(files) ? files : []) {
		const file =
			/** @type {{ name?: unknown, text?: unknown, base64?: unknown }} */ (
				rawFile ?? {}
			);
		if (typeof file.name !== "string" || file.name === "") {
			continue;
		}
		if (typeof file.base64 === "string") {
			entries.push({ name: file.name, base64: file.base64 });
		} else if (typeof file.text === "string") {
			entries.push({ name: file.name, base64: encodeText(file.text) });
		}
	}
	return entries;
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
		const options = readScrapeOptions(raw);
		runScrape(options.autoScroll, options.videoMode).then(respond);
		return true;
	}
	if (raw.type === MESSAGE_TYPES.BUILD_ZIP) {
		buildZipReply(raw).then(respond);
		return true;
	}
	respond(
		reply(MESSAGE_TYPES.SCRAPE_ERROR, {
			code: "UNSUPPORTED",
			detail:
				"Content script handles PING, SCRAPE_START, BUILD_ZIP and SCRAPE_CANCEL",
		}),
	);
	return false;
});
