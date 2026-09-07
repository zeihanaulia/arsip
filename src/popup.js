/** Popup: connection check plus Task 2-3 JSON download with polling. */
import { createMessage, isMessage, MESSAGE_TYPES } from "./messaging.js";

const POLL_INTERVAL_MS = 600;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

const statusEl = document.querySelector("#status");
const pingButton = document.querySelector("#ping");
const downloadButton = document.querySelector("#download");
const cancelButton = document.querySelector("#cancel");
const autoscrollBox = document.querySelector("#autoscroll");

/** @type {boolean} */
let polling = false;

pingButton?.addEventListener("click", async () => {
	setStatus("checking…");
	setStatus(await pingContentScript());
});

downloadButton?.addEventListener("click", async () => {
	await downloadVisibleThread();
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
	setButtons({ downloading: true });
	setStatus(autoScroll ? "expanding thread…" : "scraping visible tweets…");
	try {
		await withTimeout(
			chrome.runtime.sendMessage(
				createMessage(MESSAGE_TYPES.SCRAPE_START, { autoScroll }),
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
 * @returns {Promise<boolean>} True when the job reached a terminal state.
 */
async function pollOnce() {
	let reply;
	try {
		reply = await withTimeout(
			chrome.runtime.sendMessage(createMessage(MESSAGE_TYPES.SCRAPE_STATUS)),
			10_000,
		);
	} catch {
		return false;
	}
	if (!isMessage(reply)) {
		return false;
	}
	const payload = /** @type {Record<string, unknown>} */ (reply.payload);
	const result =
		/** @type {{ type?: string, payload?: Record<string, unknown> } | null} */ (
			payload.result ?? null
		);
	if (result && isMessage(result)) {
		polling = false;
		if (result.type === MESSAGE_TYPES.SCRAPE_DONE) {
			setStatus(
				`downloaded ${result.payload.filename} (${result.payload.count} tweets)`,
			);
		} else {
			setStatus(`failed: ${JSON.stringify(result.payload)}`);
		}
		return true;
	}
	const tweets = typeof payload.tweets === "number" ? payload.tweets : 0;
	const phase = typeof payload.phase === "string" ? payload.phase : "scraping";
	setStatus(`${phase}… ${tweets} tweets so far`);
	return false;
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
		return isMessage(reply) && reply.payload.connected === true
			? "connected: true"
			: "connected: false";
	} catch (error) {
		return error instanceof Error
			? `not reachable: ${error.message}`
			: "content script not reachable on this page";
	}
}
