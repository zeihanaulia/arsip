/** Popup: connection check plus Task 2 JSON download. */
import { createMessage, isMessage, MESSAGE_TYPES } from "./messaging.js";

const statusEl = document.querySelector("#status");
const pingButton = document.querySelector("#ping");
const downloadButton = document.querySelector("#download");

pingButton?.addEventListener("click", async () => {
	setStatus("checking…");
	setStatus(await pingContentScript());
});

downloadButton?.addEventListener("click", async () => {
	setStatus("scraping visible tweets…");
	setStatus(await downloadVisibleThread());
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
 * @returns {Promise<string>}
 */
async function downloadVisibleThread() {
	try {
		const reply = await withTimeout(
			chrome.runtime.sendMessage(createMessage(MESSAGE_TYPES.SCRAPE_START)),
			30_000,
		);
		if (!isMessage(reply)) {
			return "unexpected response from background";
		}
		if (reply.type === MESSAGE_TYPES.SCRAPE_DONE) {
			return `downloaded ${reply.payload.filename} (${reply.payload.count} tweets)`;
		}
		return `failed: ${JSON.stringify(reply.payload)}`;
	} catch (error) {
		return error instanceof Error
			? `not reachable: ${error.message}`
			: "download failed";
	}
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
