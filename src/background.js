/**
 * Thin orchestrator: relays popup requests to the tab and triggers
 * `chrome.downloads` on completion. Never touches page DOM or media bytes.
 */
import { createMessage, isMessage, MESSAGE_TYPES } from "./messaging.js";
import {
	assembleSnapshot,
	filenameForSnapshot,
	snapshotToDataUrl,
	validateSnapshot,
} from "./snapshot.js";

chrome.runtime.onMessage.addListener((raw, _sender, respond) => {
	if (!isMessage(raw)) {
		respond(createMessage(MESSAGE_TYPES.SCRAPE_ERROR, { code: "BAD_MESSAGE" }));
		return false;
	}
	if (raw.type === MESSAGE_TYPES.SCRAPE_START) {
		downloadVisibleThread().then(respond);
		return true;
	}
	forwardToActiveTab(raw).then(respond);
	return true;
});

/**
 * Full Task 2 path: scrape the loaded tweets, validate, download JSON.
 * Never rejects: the popup awaits our response, so a throw here would
 * hang it until the message channel closes.
 *
 * @returns {Promise<import("./messaging.js").Message>}
 */
async function downloadVisibleThread() {
	try {
		return await scrapeAndDownload();
	} catch (error) {
		return createMessage(MESSAGE_TYPES.SCRAPE_ERROR, {
			code: "UNEXPECTED",
			detail: error instanceof Error ? error.message : "unknown error",
		});
	}
}

/**
 * @returns {Promise<import("./messaging.js").Message>}
 */
async function scrapeAndDownload() {
	const reply = await forwardToActiveTab(
		createMessage(MESSAGE_TYPES.SCRAPE_START),
	);
	if (!isMessage(reply) || reply.type !== MESSAGE_TYPES.SCRAPE_DONE) {
		return createMessage(MESSAGE_TYPES.SCRAPE_ERROR, {
			code: "SCRAPE_FAILED",
		});
	}
	const payload = /** @type {{ tweets?: unknown[], sourceUrl?: string }} */ (
		reply.payload
	);
	const snapshot = assembleSnapshot(
		/** @type {import("./model.js").TweetInput[]} */ (
			/** @type {unknown} */ (payload.tweets ?? [])
		),
		typeof payload.sourceUrl === "string" ? payload.sourceUrl : "",
	);
	const errors = validateSnapshot(snapshot);
	if (errors.length > 0) {
		return createMessage(MESSAGE_TYPES.SCRAPE_ERROR, {
			code: "VALIDATION_FAILED",
			errors,
		});
	}
	const filename = filenameForSnapshot(snapshot);
	const url = snapshotToDataUrl(snapshot);
	await chrome.downloads.download({ url, filename, saveAs: false });
	return createMessage(MESSAGE_TYPES.SCRAPE_DONE, {
		filename,
		count: snapshot.tweets.length,
	});
}

/**
 * @param {import("./messaging.js").Message} message
 * @returns {Promise<unknown>}
 */
async function forwardToActiveTab(message) {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (tab?.id === undefined) {
		return createMessage(MESSAGE_TYPES.SCRAPE_ERROR, { code: "NO_ACTIVE_TAB" });
	}
	return chrome.tabs.sendMessage(tab.id, message);
}
