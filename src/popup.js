/** Popup: connection check plus Task 2-3 JSON download with polling. */
import { createMessage, isMessage, MESSAGE_TYPES } from "./messaging.js";
import { detectAdapter } from "./sites/registry.js";

const POLL_INTERVAL_MS = 600;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

const statusEl = document.querySelector("#status");
const pingButton = document.querySelector("#ping");
const downloadButton = document.querySelector("#download");
const cancelButton = document.querySelector("#cancel");
const autoscrollBox = document.querySelector("#autoscroll");
const skipPromotedBox = document.querySelector("#skippromoted");
const videoModeBox = document.querySelector("#videomode");
const netlogButton = document.querySelector("#netlog");
const presetBox = document.querySelector("#preset");
const customFormats = document.querySelector("#custom-formats");
const progressBar = document.querySelector("#progress");

const PRESET_FORMATS = [
	"thread.html",
	"thread.md",
	"thread.json",
	"thread.csv",
	"thread.xlsx",
];

/** @type {boolean} */
let polling = false;

const UNSUPPORTED_SITE_MESSAGE =
	"Arsip hanya mendukung thread X dan video YouTube — buka salah satunya dulu.";

pingButton?.addEventListener("click", async () => {
	if (!(await activeSupportedTab())) {
		setStatus(UNSUPPORTED_SITE_MESSAGE);
		return;
	}
	setStatus("checking…");
	setStatus(await pingContentScript());
});

downloadButton?.addEventListener("click", async () => {
	if (!(await activeSupportedTab())) {
		setStatus(UNSUPPORTED_SITE_MESSAGE);
		return;
	}
	await downloadVisibleThread();
});
presetBox?.addEventListener("change", () => {
	if (customFormats instanceof HTMLFieldSetElement) {
		customFormats.hidden =
			!(presetBox instanceof HTMLSelectElement) || presetBox.value !== "custom";
	}
});

netlogButton?.addEventListener("click", async () => {
	if (!(await activeCaptureTab())) {
		setStatus(UNSUPPORTED_SITE_MESSAGE);
		return;
	}
	setStatus("fetching network log…");
	setStatus(await downloadNetworkLog());
});

cancelButton?.addEventListener("click", async () => {
	polling = false;
	try {
		await chrome.runtime.sendMessage(
			createMessage(MESSAGE_TYPES.SCRAPE_CANCEL),
		);
	} catch {
		// Background already gone; the scrape stops with the tab anyway.
	}
	setStatus("cancelled — a partial file may still download.");
	setButtons({ downloading: false });
});

/**
 * The active tab only when it is an X thread page (the only pages our
 * content scripts are injected into). Anything else is refused up front
 * with an explicit message instead of a confusing channel error.
 *
 * @returns {Promise<boolean>}
 */
async function activeThreadTab() {
	try {
		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});
		const host = new URL(tab?.url ?? "").hostname.toLowerCase();
		return (
			tab?.id !== undefined &&
			(host === "x.com" ||
				host.endsWith(".x.com") ||
				host === "twitter.com" ||
				host.endsWith(".twitter.com"))
		);
	} catch {
		return false;
	}
}

/**
 * The active tab only when it is a YouTube watch page. Detection lives
 * in the registry — the popup never hardcodes hosts beyond X.
 *
 * @returns {Promise<boolean>}
 */
async function activeVideoTab() {
	try {
		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});
		if (tab?.id === undefined) {
			return false;
		}
		return detectAdapter(tab.url ?? "") === "youtube";
	} catch {
		return false;
	}
}

/**
 * Either supported surface: thread (X) or transcript (YouTube).
 *
 * @returns {Promise<boolean>}
 */
async function activeSupportedTab() {
	if (await activeThreadTab()) {
		return true;
	}
	return activeVideoTab();
}

/**
 * Network-log capture runs everywhere our hook is injected (X today,
 * YouTube for transcript field work) while full download support stays
 * per-site. Detection lives in the registry — the popup never hardcodes
 * hosts beyond X.
 *
 * @returns {Promise<boolean>}
 */
async function activeCaptureTab() {
	if (await activeThreadTab()) {
		return true;
	}
	try {
		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});
		if (tab?.id === undefined) {
			return false;
		}
		return detectAdapter(tab.url ?? "") !== null;
	} catch {
		return false;
	}
}

/**
 * @param {string} text
 */
function setStatus(text) {
	if (statusEl) {
		statusEl.textContent = text;
	}
}

/**
 * Kicks off the scrape, then polls STATUS until the background reports
 * a finished result. Polling (not one long await) survives worker restarts
 * and keeps the UI responsive enough for Cancel.
 */
async function downloadVisibleThread() {
	const autoScroll =
		autoscrollBox instanceof HTMLInputElement && autoscrollBox.checked;
	const videoMode = readVideoMode();
	const skipPromoted =
		!(skipPromotedBox instanceof HTMLInputElement) || skipPromotedBox.checked;
	const { preset, formats } = readPreset();
	const site = (await activeVideoTab()) ? "youtube" : "x";
	setButtons({ downloading: true });
	setStatus(startStatus(site, autoScroll));
	try {
		await withTimeout(
			chrome.runtime.sendMessage(
				createMessage(MESSAGE_TYPES.SCRAPE_START, {
					site,
					autoScroll,
					videoMode,
					preset,
					formats,
					skipPromoted,
				}),
			),
			10_000,
		);
	} catch (error) {
		setButtons({ downloading: false });
		setStatus(
			error instanceof Error
				? `not reachable: ${error.message}`
				: "download failed",
		);
		return;
	}
	polling = true;
	const started = Date.now();
	while (polling && Date.now() - started < POLL_TIMEOUT_MS) {
		await sleep(POLL_INTERVAL_MS);
		if (!polling) {
			break;
		}
		const done = await pollOnce();
		if (done) {
			break;
		}
	}
	if (polling) {
		setStatus("timed out waiting — reload the tab and try again.");
	}
	setButtons({ downloading: false });
	polling = false;
}

/**
 * One-shot network log download (Task 7 slice 1): no polling, the
 * background answers directly.
 *
 * @returns {Promise<string>}
 */
async function downloadNetworkLog() {
	try {
		const reply = await withTimeout(
			chrome.runtime.sendMessage(createMessage(MESSAGE_TYPES.DUMP_NETWORK)),
			30_000,
		);
		if (
			isMessage(reply) &&
			reply.type === MESSAGE_TYPES.SCRAPE_DONE &&
			typeof reply.payload.filename === "string"
		) {
			return `downloaded ${reply.payload.filename} (${String(reply.payload.entries ?? 0)} entries)`;
		}
		return `failed: ${JSON.stringify(isMessage(reply) ? reply.payload : reply)}`;
	} catch (error) {
		return error instanceof Error
			? `not reachable: ${error.message}`
			: "download failed";
	}
}

/**
 * @returns {{ preset: string, formats: string[] }}
 */
function readPreset() {
	const preset =
		presetBox instanceof HTMLSelectElement ? presetBox.value : "llm";
	if (preset !== "custom") {
		return { preset, formats: [] };
	}
	const formats = PRESET_FORMATS.filter((name) => {
		const box = document.querySelector(`#fmt-${name.split(".")[1]}`);
		return box instanceof HTMLInputElement && box.checked;
	});
	return { preset, formats };
}

/**
 * UI default is "separate": videos are heavy and LLMs cannot watch them.
 *
 * @returns {string}
 */
function readVideoMode() {
	const value =
		videoModeBox instanceof HTMLSelectElement ? videoModeBox.value : "";
	return value === "bundle" || value === "posters-only" ? value : "separate";
}

/**
 * @returns {Promise<boolean>} True when the job reached a terminal state.
 */
async function pollOnce() {
	const payload = await fetchStatus();
	if (!payload) {
		return false;
	}
	const result =
		/** @type {{ type?: string, payload?: Record<string, unknown> } | null} */ (
			payload.result ?? null
		);
	if (result && isMessage(result)) {
		polling = false;
		renderResult(result);
		return true;
	}
	renderProgress(payload);
	return false;
}

/**
 * @returns {Promise<Record<string, unknown> | null>} Null when unreachable.
 */
async function fetchStatus() {
	try {
		const reply = await withTimeout(
			chrome.runtime.sendMessage(createMessage(MESSAGE_TYPES.SCRAPE_STATUS)),
			10_000,
		);
		return isMessage(reply)
			? /** @type {Record<string, unknown>} */ (reply.payload)
			: null;
	} catch {
		return null;
	}
}

/**
 * @param {{ type?: string, payload?: Record<string, unknown> }} result
 */
function renderResult(result) {
	if (result.type !== MESSAGE_TYPES.SCRAPE_DONE) {
		setStatus(`failed: ${JSON.stringify(result.payload)}`);
		return;
	}
	const payload = result.payload ?? {};
	if (payload.kind === "video") {
		setStatus(`downloaded ${payload.filename} (${payload.count} segments).`);
		return;
	}
	const media = /** @type {{ downloaded?: unknown }} */ (payload.media ?? {});
	const mediaText =
		typeof media.downloaded === "number" ? `, ${media.downloaded} media` : "";
	const rootHint =
		payload.rootCaptured === false
			? " Root tweet not captured — open the root tweet or scroll up, then download again."
			: "";
	const scrollerHint =
		payload.scrollerMissing === true
			? " Auto-expand did not run (stale tab?) — reload the tab, then download again."
			: "";
	setStatus(
		`downloaded ${payload.filename} (${payload.count} tweets${mediaText}, stopped: ${payload.stoppedWhy ?? "unknown"}).${rootHint}${scrollerHint}`,
	);
}

/**
 * What the status line says while the job starts. One place so the
 * per-site wording stays consistent.
 *
 * @param {string} site "youtube" or "x".
 * @param {boolean} autoScroll
 * @returns {string}
 */
function startStatus(site, autoScroll) {
	if (site === "youtube") {
		return "scraping captions…";
	}
	return autoScroll ? "expanding thread…" : "scraping visible tweets…";
}

/**
 * @param {Record<string, unknown>} payload
 */
function renderProgress(payload) {
	const tweets = typeof payload.tweets === "number" ? payload.tweets : 0;
	const batches = typeof payload.batches === "number" ? payload.batches : 0;
	const phase = typeof payload.phase === "string" ? payload.phase : "scraping";
	const stopped =
		typeof payload.stoppedWhy === "string" ? `, ${payload.stoppedWhy}` : "";
	setStatus(`${phase}… ${tweets} tweets, batch ${batches}${stopped}`);
}

/**
 * @param {{ downloading: boolean }} state
 */
function setButtons(state) {
	if (downloadButton instanceof HTMLButtonElement) {
		downloadButton.disabled = state.downloading;
	}
	if (cancelButton instanceof HTMLButtonElement) {
		cancelButton.disabled = !state.downloading;
	}
	if (progressBar instanceof HTMLProgressElement) {
		progressBar.hidden = !state.downloading;
	}
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * Guarantees the popup never spins forever when the background hangs.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
	const guard = new Promise((_, reject) => {
		const timer = setTimeout(() => {
			reject(
				new Error(`timed out after ${ms / 1000}s — reload the extension tab`),
			);
		}, ms);
		promise.finally(() => {
			clearTimeout(timer);
		});
	});
	return Promise.race([promise, guard]);
}

/**
 * @returns {Promise<string>}
 */
async function pingContentScript() {
	try {
		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});
		if (tab?.id === undefined) {
			return "no active tab";
		}
		const reply = await chrome.tabs.sendMessage(
			tab.id,
			createMessage(MESSAGE_TYPES.PING),
		);
		if (!isMessage(reply) || reply.payload.connected !== true) {
			return "connected: false";
		}
		const caps = /** @type {Record<string, unknown>} */ (
			reply.payload.caps ?? {}
		);
		const missing = expectedCaps(tab.url).filter((key) => caps[key] !== true);
		if (missing.length === 0) {
			return "connected: true";
		}
		return reloadStaleTab(tab.id, missing);
	} catch (error) {
		return error instanceof Error
			? `not reachable: ${error.message}`
			: "content script not reachable on this page";
	}
}

/**
 * A stale tab means the extension was reloaded after the tab opened
 * (its content scripts are orphaned). Fix it on the spot instead of
 * nagging the user to reload manually — no extra permission needed for
 * tabs.reload. Falls back to the old nag when reload itself fails.
 *
 * @param {number} tabId
 * @param {string[]} missing
 * @returns {Promise<string>}
 */
async function reloadStaleTab(tabId, missing) {
	try {
		await chrome.tabs.reload(tabId);
		return `Reloading the tab to refresh the scraper (was missing: ${missing.join(", ")}) — check again in a few seconds.`;
	} catch {
		return `connected: true — stale tab, missing: ${missing.join(", ")} (reload the tab)`;
	}
}

/**
 * Capabilities that must be present per surface. YouTube needs only the
 * hook (capture buffer) and the zip builder — no scroller, no media
 * fetcher, no sheet writer. A video tab missing those is healthy, not stale.
 *
 * @param {string | undefined} url
 * @returns {string[]}
 */
function expectedCaps(url) {
	if (detectAdapter(url ?? "") === "youtube") {
		return ["hook", "zip"];
	}
	return ["hook", "scroller", "media", "zip", "sheet"];
}

/**
 * Labels the download button for the current surface so the user knows
 * what they are about to archive. Best-effort: failures keep the
 * default thread wording.
 */
async function initSiteMode() {
	try {
		if (await activeVideoTab()) {
			if (downloadButton instanceof HTMLButtonElement) {
				downloadButton.textContent = "Download transcript";
			}
			setStatus("Open a YouTube video, then download.");
		}
	} catch {
		// Default labels stand.
	}
}

void initSiteMode();
