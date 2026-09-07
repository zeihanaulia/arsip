/**
 * Thin orchestrator: relays popup requests to the tab and triggers
 * `chrome.downloads` on completion. Never touches page DOM or media bytes.
 *
 * Progress lives in module memory: the worker may sleep between polls,
 * so the popup treats a stale phase as "still working" and always has
 * its own overall timeout as the last line of defence.
 */
import { createMessage, isMessage, MESSAGE_TYPES } from "./messaging.js";
import {
	archiveFilenameForSnapshot,
	assembleSnapshot,
	assignThreadRelations,
	buildMediaManifest,
	validateSnapshot,
} from "./snapshot.js";

/** @type {Record<string, unknown>} */
let lastProgress = { phase: "idle", tweets: 0, batches: 0 };
/** @type {import("./messaging.js").Message | null} */
let lastResult = null;

chrome.runtime.onMessage.addListener((raw, _sender, respond) => {
	if (!isMessage(raw)) {
		respond(createMessage(MESSAGE_TYPES.SCRAPE_ERROR, { code: "BAD_MESSAGE" }));
		return false;
	}
	if (raw.type === MESSAGE_TYPES.SCRAPE_START) {
		lastProgress = { phase: "scraping", tweets: 0, batches: 0 };
		lastResult = null;
		downloadThread(readAutoScroll(raw)).then((result) => {
			lastResult = result;
		});
		respond(createMessage(MESSAGE_TYPES.SCRAPE_PROGRESS, { phase: "started" }));
		return false;
	}
	if (raw.type === MESSAGE_TYPES.SCRAPE_PROGRESS) {
		lastProgress = { ...raw.payload };
		respond(createMessage(MESSAGE_TYPES.SCRAPE_PROGRESS, { received: true }));
		return false;
	}
	if (raw.type === MESSAGE_TYPES.SCRAPE_STATUS) {
		respond(
			createMessage(MESSAGE_TYPES.SCRAPE_PROGRESS, {
				...lastProgress,
				result: lastResult,
			}),
		);
		return false;
	}
	if (raw.type === MESSAGE_TYPES.SCRAPE_CANCEL) {
		forwardToActiveTab(raw).then(respond);
		return true;
	}
	forwardToActiveTab(raw).then(respond);
	return true;
});

/**
 * @param {import("./messaging.js").Message} message
 * @returns {boolean}
 */
function readAutoScroll(message) {
	const payload = message.payload ?? {};
	return (
		typeof payload === "object" &&
		payload !== null &&
		/** @type {{ autoScroll?: unknown }} */ (payload).autoScroll === true
	);
}

/**
 * Full Task 2-3 path: scrape the loaded tweets (optionally auto-expand
 * first), attach thread relations, validate, download JSON.
 * Never rejects: the popup polls for the result instead of awaiting it.
 *
 * @param {boolean} autoScroll
 * @returns {Promise<import("./messaging.js").Message>}
 */
async function downloadThread(autoScroll) {
	try {
		return await scrapeAndDownload(autoScroll);
	} catch (error) {
		return createMessage(MESSAGE_TYPES.SCRAPE_ERROR, {
			code: "UNEXPECTED",
			detail: error instanceof Error ? error.message : "unknown error",
		});
	}
}

/**
 * @param {boolean} autoScroll
 * @returns {Promise<import("./messaging.js").Message>}
 */
async function scrapeAndDownload(autoScroll) {
	const reply = await forwardToActiveTab(
		createMessage(MESSAGE_TYPES.SCRAPE_START, { autoScroll }),
	);
	if (!isMessage(reply) || reply.type !== MESSAGE_TYPES.SCRAPE_DONE) {
		return createMessage(MESSAGE_TYPES.SCRAPE_ERROR, {
			code: "SCRAPE_FAILED",
		});
	}
	const payload =
		/** @type {{ tweets?: unknown[], sourceUrl?: string, media?: unknown[] }} */ (
			reply.payload
		);
	const sourceUrl =
		typeof payload.sourceUrl === "string" ? payload.sourceUrl : "";
	const snapshot = assembleSnapshot(
		/** @type {import("./model.js").TweetInput[]} */ (
			/** @type {unknown} */ (payload.tweets ?? [])
		),
		sourceUrl,
	);
	snapshot.tweets = assignThreadRelations(snapshot.tweets, sourceUrl);
	const rawMedia = Array.isArray(payload.media) ? payload.media : [];
	const mediaItems = manifestItems(rawMedia);
	const manifest = buildMediaManifest(mediaItems);
	const errors = validateSnapshot(snapshot);
	if (errors.length > 0) {
		return createMessage(MESSAGE_TYPES.SCRAPE_ERROR, {
			code: "VALIDATION_FAILED",
			errors,
		});
	}
	const zipReply = await forwardToActiveTab(
		createMessage(MESSAGE_TYPES.BUILD_ZIP, {
			files: zipFiles(snapshot, manifest, rawMedia),
		}),
	);
	if (
		!isMessage(zipReply) ||
		zipReply.type !== MESSAGE_TYPES.SCRAPE_DONE ||
		typeof zipReply.payload.zipBase64 !== "string"
	) {
		return createMessage(MESSAGE_TYPES.SCRAPE_ERROR, {
			code: "ZIP_FAILED",
		});
	}
	const filename = archiveFilenameForSnapshot(snapshot);
	await chrome.downloads.download({
		url: `data:application/zip;base64,${zipReply.payload.zipBase64}`,
		filename,
		saveAs: false,
	});
	const downloaded = mediaItems.filter((item) => !item.unresolved).length;
	return createMessage(MESSAGE_TYPES.SCRAPE_DONE, {
		filename,
		count: snapshot.tweets.length,
		stoppedWhy:
			typeof lastProgress.stoppedWhy === "string"
				? lastProgress.stoppedWhy
				: "viewport-only",
		batches:
			typeof lastProgress.batches === "number" ? lastProgress.batches : 0,
		media: { downloaded, unresolved: mediaItems.length - downloaded },
	});
}

/**
 * Picks only the manifest fields so download bytes never leak into it.
 *
 * @param {unknown} raw
 * @returns {{ tweetId: string, url: string, type: string, localPath?: string, mime?: string, unresolved?: string }[]}
 */
function manifestItems(raw) {
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.map((entry) => {
		const item = /** @type {Record<string, unknown>} */ (entry ?? {});
		const picked = {
			tweetId: typeof item.tweetId === "string" ? item.tweetId : "",
			url: typeof item.url === "string" ? item.url : "",
			type: typeof item.type === "string" ? item.type : "unknown",
		};
		if (typeof item.unresolved === "string") {
			return { ...picked, unresolved: item.unresolved };
		}
		return {
			...picked,
			localPath: typeof item.localPath === "string" ? item.localPath : "",
			mime: typeof item.mime === "string" ? item.mime : "",
		};
	});
}

/**
 * @param {import("./model.js").ThreadSnapshot} snapshot
 * @param {Record<string, object>} manifest
 * @param {unknown[]} rawMedia Original content-script items (may carry bytes).
 * @returns {{ name: string, text?: string, base64?: string }[]}
 */
function zipFiles(snapshot, manifest, rawMedia) {
	const /** @type {{ name: string, text?: string, base64?: string }[]} */ files =
			[
				{ name: "thread.json", text: JSON.stringify(snapshot, null, 2) },
				{
					name: "media-manifest.json",
					text: JSON.stringify(manifest, null, 2),
				},
			];
	for (const entry of rawMedia ?? []) {
		const item = /** @type {Record<string, unknown>} */ (entry ?? {});
		if (
			typeof item.unresolved !== "string" &&
			typeof item.localPath === "string" &&
			typeof item.base64 === "string"
		) {
			files.push({ name: item.localPath, base64: item.base64 });
		}
	}
	return files;
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
