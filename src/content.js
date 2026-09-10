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
	DUMP_NETWORK: "DUMP_NETWORK",
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
 * Reports which companion scripts share this tab. DOM attributes cross
 * isolated worlds (JS expando properties do not), so the MAIN-world
 * hook is detected via its document marker, not a window property.
 *
 * @returns {{ hook: boolean, scroller: boolean, media: boolean, zip: boolean, sheet: boolean }}
 */
function capabilities() {
	const globals =
		/** @type {{ XScroller?: unknown, XMedia?: unknown, JSZip?: unknown, XLSX?: unknown }} */ (
			globalThis
		);
	const marker =
		typeof document !== "undefined"
			? document.documentElement?.getAttribute("data-arsip-hook")
			: null;
	return {
		hook: marker === "main",
		scroller: typeof globals.XScroller !== "undefined",
		media: typeof globals.XMedia !== "undefined",
		zip: typeof globals.JSZip !== "undefined",
		sheet: typeof globals.XLSX !== "undefined",
	};
}

/**
 * Network capture buffer fed by the MAIN-world hook via DOM events
 * (event name shared with src/hook-main.js). Newest entries win when
 * the dump would exceed the message channel budget.
 */
const MAX_NET_LOG_BYTES = 30_000_000;
/** @type {Record<string, unknown>[]} */
const netLog = [];

window.addEventListener("arsip:net", (event) => {
	const entry = /** @type {{ detail?: unknown }} */ (event).detail;
	if (entry && typeof entry === "object") {
		netLog.push(/** @type {Record<string, unknown>} */ (entry));
		while (netLog.length > 500) {
			netLog.shift();
		}
	}
});

/**
 * @returns {Record<string, unknown>[]} Newest-first, within budget.
 */
function trimNetLog() {
	const kept = [];
	let bytes = 0;
	for (let index = netLog.length - 1; index >= 0; index -= 1) {
		const entry = netLog[index];
		bytes += JSON.stringify(entry).length;
		if (bytes > MAX_NET_LOG_BYTES) {
			break;
		}
		kept.unshift(entry);
	}
	return kept;
}

/**
 * Cooperative cancel flag, set by SCRAPE_CANCEL between scroll batches.
 * @type {boolean}
 */
let cancelRequested = false;

/**
 * @param {{ payload?: unknown }} raw
 * @returns {string} "youtube" when explicitly requested, else "x".
 * Routing uses the explicit payload.site so host detection stays in
 * the registry; the default preserves X behavior byte-for-byte.
 */
function readSiteId(raw) {
	const payload = /** @type {{ site?: unknown }} */ (raw.payload ?? {});
	return payload.site === "youtube" ? "youtube" : "x";
}

/**
 * YouTube path (jalur B): no parse here, no fetch — the background owns
 * youtube-graphql.js (ESM) while this classic script only forwards the
 * captured buffers, newest first, capped so the channel survives a
 * 250KB timedtext body or two.
 *
 * @returns {{ type: string, payload: Record<string, unknown> }}
 */
function scrapeVideoBodies() {
	/** @type {string[]} */
	const timedBodies = [];
	/** @type {string[]} */
	const playerBodies = [];
	for (let index = netLog.length - 1; index >= 0; index -= 1) {
		const entry = netLog[index];
		if (typeof entry.url !== "string" || typeof entry.body !== "string") {
			continue;
		}
		if (
			entry.url.includes("/api/timedtext") &&
			entry.body !== "" &&
			timedBodies.length < 3
		) {
			timedBodies.push(entry.body);
		} else if (
			entry.url.includes("/youtubei/v1/player") &&
			entry.body !== "" &&
			playerBodies.length < 3
		) {
			playerBodies.push(entry.body);
		}
	}
	return reply(MESSAGE_TYPES.SCRAPE_DONE, {
		timedBodies,
		playerBodies,
		sourceUrl: location.href,
	});
}

/**
 * @param {unknown} raw
 * @returns {{ autoScroll: boolean, videoMode: string, skipPromoted: boolean }}
 */
function readScrapeOptions(raw) {
	const payload = /** @type {{ payload?: unknown }} */ (raw).payload;
	const options =
		/** @type {{ autoScroll?: unknown, videoMode?: unknown, skipPromoted?: unknown }} */ (
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
		skipPromoted: options.skipPromoted !== false,
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
 * @param {boolean} skipPromoted Drop paid placements before downloading.
 * @returns {Promise<{ type: string, payload: Record<string, unknown> }>}
 */
async function runScrape(autoScroll, videoMode, skipPromoted) {
	cancelRequested = false;
	const scroller = readScroller();
	const collected = new Map();
	accumulateBatch(collected);
	let scrollerMissing = false;
	if (autoScroll) {
		scrollerMissing = await expandThread(scroller, () =>
			accumulateBatch(collected),
		);
	}
	if (scroller && typeof scroller.mountLazyMedia === "function") {
		postProgress({ phase: "mounting" });
		await scroller.mountLazyMedia(document);
	}
	const scraped = scrapeSafely();
	if (scraped.type !== MESSAGE_TYPES.SCRAPE_DONE) {
		return scraped;
	}
	accumulateBatch(collected);
	const tweets = dropPromoted(
		collected.size > 0
			? [...collected.values()]
			: /** @type {unknown[]} */ (scraped.payload.tweets ?? []),
		skipPromoted,
	);
	// Consume-then-clear: bodies captured while reading this thread ride
	// along, but must never leak into the next download.
	const api = timelineApiBodies();
	netLog.length = 0;
	return reply(MESSAGE_TYPES.SCRAPE_DONE, {
		tweets,
		sourceUrl: scraped.payload.sourceUrl ?? "",
		scrollerMissing,
		caps: capabilities(),
		api,
		media: await downloadThreadMedia(tweets, videoMode),
	});
}

/**
 * Drops paid placements so their media is never fetched. Off by
 * explicit opt-out only.
 *
 * @param {unknown[]} tweets
 * @param {boolean} skip
 * @returns {unknown[]}
 */
function dropPromoted(tweets, skip) {
	if (!skip) {
		return tweets;
	}
	return (tweets ?? []).filter((raw) => {
		if (!raw || typeof raw !== "object") {
			return true;
		}
		return /** @type {{ promoted?: unknown }} */ (raw).promoted !== true;
	});
}

/**
 * Unions one DOM scrape into the cross-batch collection (first sighting
 * wins). The timeline virtualizer removes far tweets as you scroll, so
 * the last scrape alone would silently drop everything loaded earlier.
 *
 * @param {Map<string, unknown>} collected
 */
function accumulateBatch(collected) {
	try {
		const adapter =
			/** @type {{ scrapeRaw?: (doc: Document, url: string) => { tweets: unknown[] } } | undefined} */ (
				globalThis.XAdapter
			);
		const batch = adapter?.scrapeRaw?.(document, "")?.tweets ?? [];
		for (const raw of batch) {
			if (!raw || typeof raw !== "object") {
				continue;
			}
			const id = /** @type {{ id?: unknown }} */ (raw).id;
			if (typeof id === "string" && id !== "" && !collected.has(id)) {
				collected.set(id, raw);
			}
		}
	} catch {
		// A failed batch scrape must not kill the collected tweets.
	}
}

/**
 * Bodies of captured timeline API responses (TweetDetail and siblings),
 * newest first, capped so the message channel survives. The background
 * parses them; unparseable bodies are skipped there, never here.
 *
 * @returns {string[]}
 */
function timelineApiBodies() {
	const bodies = [];
	for (let index = netLog.length - 1; index >= 0; index -= 1) {
		const entry = netLog[index];
		if (
			typeof entry.url === "string" &&
			/TweetDetail|TweetResultByRestId|HomeTimeline|SearchTimeline/.test(
				entry.url,
			) &&
			typeof entry.body === "string" &&
			entry.body !== ""
		) {
			bodies.push(entry.body);
		}
		if (bodies.length >= 15) {
			break;
		}
	}
	return bodies;
}

/**
 * @returns {{ expandAndScroll?: (...args: unknown[]) => Promise<Record<string, unknown>>, mountLazyMedia?: (doc: Document) => Promise<number> } | undefined}
 */
function readScroller() {
	return /** @type {{ expandAndScroll?: (...args: unknown[]) => Promise<Record<string, unknown>>, mountLazyMedia?: (doc: Document) => Promise<number> } | undefined} */ (
		globalThis.XScroller
	);
}

/**
 * Runs the expand phase: click "show more", scroll in batches, report
 * progress. Never throws — expansion is best-effort on top of the
 * viewport scrape that always follows.
 *
 * @param {{ expandAndScroll?: (...args: unknown[]) => Promise<Record<string, unknown>> } | undefined} scroller
 * @param {() => void} [onBatch] Runs after every scrolled batch.
 * @returns {Promise<boolean>} True when the scroller was missing entirely.
 */
async function expandThread(scroller, onBatch) {
	if (!scroller || typeof scroller.expandAndScroll !== "function") {
		postProgress({ phase: "scraping", scrollerMissing: true });
		return true;
	}
	try {
		const stats = await scroller.expandAndScroll(
			document,
			{ shouldStop: () => cancelRequested },
			(/** @type {Record<string, unknown>} */ progress) => {
				onBatch?.();
				postProgress({ phase: "expanding", ...progress });
			},
		);
		postProgress({ phase: "scraping", ...(stats ?? {}) });
	} catch (error) {
		postProgress({
			phase: "scraping",
			stoppedWhy: "expand-error",
			batches: 0,
			expandError: error instanceof Error ? error.message : "unknown error",
		});
	}
	return false;
}

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
		if (!fetched) {
			return { ...base, unresolved: "fetch-failed" };
		}
		const localPath = media.localName?.(tweetId, index, url, fetched.mime);
		return { ...base, localPath, mime: fetched.mime, base64: fetched.base64 };
	} catch (error) {
		return { ...base, unresolved: classifyFetchError(error) };
	}
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function classifyFetchError(error) {
	if (error instanceof Error && error.message === "media-too-large") {
		return "too-large";
	}
	if (error instanceof Error && error.name === "AbortError") {
		return "fetch-timeout";
	}
	return "fetch-failed";
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
		const { buildZip, bytesToBase64, JSZipClass, XLSXClass } =
			requireZipLibraries();
		const envelope = /** @type {{ payload?: { files?: unknown } }} */ (raw);
		const entries = [
			...toZipEntries(envelope.payload?.files, (text) =>
				bytesToBase64(new TextEncoder().encode(text)),
			),
			...sheetEntriesToBytes(envelope.payload?.files, XLSXClass),
		];
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
 * @returns {{ buildZip: (files: { name: string, base64: string }[], JSZipClass: unknown) => Promise<string>, bytesToBase64: (bytes: Uint8Array) => string, JSZipClass: unknown, XLSXClass: unknown }}
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
	const XLSXClass = /** @type {unknown} */ (
		/** @type {{ XLSX?: unknown }} */ (globalThis).XLSX
	);
	return {
		buildZip: media.buildZip,
		bytesToBase64: media.bytesToBase64,
		JSZipClass,
		XLSXClass,
	};
}

/**
 * Converts sheet entries ({name, sheet:{columns, rows}}) into xlsx bytes
 * with the vendored SheetJS. Throws when the library is absent so a
 * missing spreadsheet fails loudly instead of vanishing from the ZIP.
 *
 * @param {unknown} files
 * @param {unknown} XLSXClass
 * @returns {{ name: string, base64: string }[]}
 */
function sheetEntriesToBytes(files, XLSXClass) {
	const sheets = [];
	for (const rawFile of Array.isArray(files) ? files : []) {
		const file = /** @type {{ name?: unknown, sheet?: unknown }} */ (
			rawFile ?? {}
		);
		if (typeof file.name === "string" && file.name !== "" && file.sheet) {
			sheets.push({ name: file.name, sheet: file.sheet });
		}
	}
	if (sheets.length === 0) {
		return [];
	}
	const lib =
		/** @type {{ utils: { book_new: () => unknown, aoa_to_sheet: (data: unknown[][]) => unknown, book_append_sheet: (wb: unknown, ws: unknown, name: string) => unknown }, write: (wb: unknown, options: object) => string } | null } */ (
			XLSXClass && typeof XLSXClass === "object" ? XLSXClass : null
		);
	if (!lib || typeof lib.write !== "function") {
		throw new Error(
			"sheet library (SheetJS) not loaded — reload the extension",
		);
	}
	return sheets.map(({ name, sheet }) => {
		const grid = /** @type {{ columns?: unknown, rows?: unknown }} */ (
			sheet ?? {}
		);
		if (!Array.isArray(grid.columns) || !Array.isArray(grid.rows)) {
			throw new Error(`malformed sheet entry: ${name}`);
		}
		const workbook = lib.utils.book_new();
		const worksheet = lib.utils.aoa_to_sheet([grid.columns, ...grid.rows]);
		lib.utils.book_append_sheet(workbook, worksheet, "tweets");
		return {
			name,
			base64: lib.write(workbook, { type: "base64", bookType: "xlsx" }),
		};
	});
}

/**
 * Normalizes a caller-supplied file list: nameless entries are dropped,
 * inline text is encoded, ready bytes pass through untouched. Sheet
 * entries are ignored here (see sheetEntriesToBytes).
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
		respond(
			reply(MESSAGE_TYPES.PING, { connected: true, caps: capabilities() }),
		);
		return false;
	}
	if (raw.type === MESSAGE_TYPES.SCRAPE_CANCEL) {
		cancelRequested = true;
		respond(reply(MESSAGE_TYPES.SCRAPE_DONE, { cancelled: true }));
		return false;
	}
	if (raw.type === MESSAGE_TYPES.SCRAPE_START) {
		if (readSiteId(raw) === "youtube") {
			respond(scrapeVideoBodies());
			return false;
		}
		const options = readScrapeOptions(raw);
		runScrape(options.autoScroll, options.videoMode, options.skipPromoted).then(
			respond,
		);
		return true;
	}
	if (raw.type === MESSAGE_TYPES.BUILD_ZIP) {
		buildZipReply(raw).then(respond);
		return true;
	}
	if (raw.type === MESSAGE_TYPES.DUMP_NETWORK) {
		respond(reply(MESSAGE_TYPES.SCRAPE_DONE, { log: trimNetLog() }));
		return false;
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
