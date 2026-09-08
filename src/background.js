/**
 * Thin orchestrator: relays popup requests to the tab and triggers
 * `chrome.downloads` on completion. Never touches page DOM or media bytes.
 *
 * Progress lives in module memory: the worker may sleep between polls,
 * so the popup treats a stale phase as "still working" and always has
 * its own overall timeout as the last line of defence.
 */

import { renderThreadHtml, renderThreadMarkdown } from "./export-html.js";
import {
	snapshotToCsv,
	snapshotToRows,
	THREAD_COLUMNS,
} from "./export-tabular.js";
import { createMessage, isMessage, MESSAGE_TYPES } from "./messaging.js";
import {
	archiveFilenameForSnapshot,
	assembleSnapshot,
	assignThreadRelations,
	buildMediaManifest,
	captureStats,
	enrichSnapshotMedia,
	isRootCaptured,
	separateDirForArchive,
	splitMediaForMode,
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
		downloadThread(readAutoScroll(raw), readVideoMode(raw)).then((result) => {
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
 * UI default is "separate" (videos are heavy and LLMs cannot watch
 * them); unknown values fall back to "bundle" (single artifact).
 *
 * @param {import("./messaging.js").Message} message
 * @returns {string}
 */
function readVideoMode(message) {
	const payload = /** @type {{ videoMode?: unknown }} */ (
		message.payload ?? {}
	);
	return payload.videoMode === "separate" ||
		payload.videoMode === "posters-only"
		? payload.videoMode
		: "bundle";
}

/**
 * Full Task 2-4 path: scrape (optionally auto-expand first), download
 * media, attach thread relations, validate, bundle or split videos,
 * download the archive. Never rejects: the popup polls for the result.
 *
 * @param {boolean} autoScroll
 * @param {string} videoMode
 * @returns {Promise<import("./messaging.js").Message>}
 */
async function downloadThread(autoScroll, videoMode) {
	try {
		return await scrapeAndDownload(autoScroll, videoMode);
	} catch (error) {
		return createMessage(MESSAGE_TYPES.SCRAPE_ERROR, {
			code: "UNEXPECTED",
			detail: error instanceof Error ? error.message : "unknown error",
		});
	}
}

/**
 * @param {boolean} autoScroll
 * @param {string} videoMode
 * @returns {Promise<import("./messaging.js").Message>}
 */
async function scrapeAndDownload(autoScroll, videoMode) {
	const reply = await forwardToActiveTab(
		createMessage(MESSAGE_TYPES.SCRAPE_START, { autoScroll, videoMode }),
	);
	if (!isMessage(reply) || reply.type !== MESSAGE_TYPES.SCRAPE_DONE) {
		return createMessage(MESSAGE_TYPES.SCRAPE_ERROR, {
			code: "SCRAPE_FAILED",
		});
	}
	const payload =
		/** @type {{ tweets?: unknown[], sourceUrl?: string, media?: unknown[], scrollerMissing?: unknown }} */ (
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
	enrichSnapshotMedia(snapshot, rawMedia);
	const rootCaptured = isRootCaptured(snapshot);
	snapshot.capture = captureStats(lastProgress, {
		autoScroll,
		videoMode,
		rootCaptured,
	});
	const archiveFilename = archiveFilenameForSnapshot(snapshot);
	const separateDir = separateDirForArchive(archiveFilename);
	const { zip: zipMedia, separate: separateMedia } = splitMediaForMode(
		rawMedia,
		videoMode,
	);
	const separateOk = await downloadSeparateVideos(separateMedia, separateDir);
	const mediaItems = manifestItems(rawMedia, separateOk, separateDir);
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
			files: zipFiles(snapshot, manifest, zipMedia, separateOk),
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
	const filename = archiveFilename;
	await chrome.downloads.download({
		url: `data:application/zip;base64,${zipReply.payload.zipBase64}`,
		filename,
		saveAs: false,
	});
	const bundled = zipMedia.filter((entry) => {
		const item = /** @type {Record<string, unknown>} */ (entry ?? {});
		return typeof item.base64 === "string";
	}).length;
	const captions = mediaItems.filter(
		(item) => item.type === "captions" && !item.unresolved,
	).length;
	return createMessage(MESSAGE_TYPES.SCRAPE_DONE, {
		filename,
		count: snapshot.tweets.length,
		rootCaptured,
		scrollerMissing: payload.scrollerMissing === true,
		stoppedWhy: snapshot.capture?.stoppedWhy ?? "viewport-only",
		batches: snapshot.capture?.batches ?? 0,
		media: {
			downloaded: bundled,
			separate: separateOk.size,
			unresolved: mediaItems.filter((item) => item.unresolved).length,
			captions,
		},
	});
}

/**
 * Downloads videos as individual files next to the archive. Failures
 * fall back to bundling: the URL stays out of the ok-set and the bytes
 * travel in the ZIP instead.
 *
 * @param {unknown[]} separateMedia
 * @param {string} separateDir
 * @returns {Promise<Set<string>>} URLs downloaded separately.
 */
async function downloadSeparateVideos(separateMedia, separateDir) {
	const ok = new Set();
	for (const entry of separateMedia ?? []) {
		const item = /** @type {Record<string, unknown>} */ (entry ?? {});
		if (
			typeof item.url !== "string" ||
			typeof item.localPath !== "string" ||
			item.url === "" ||
			item.localPath === ""
		) {
			continue;
		}
		const filename = separateDir + item.localPath.split("/").pop();
		try {
			await chrome.downloads.download({
				url: item.url,
				filename,
				saveAs: false,
			});
			ok.add(item.url);
		} catch {
			// Falls back to ZIP bundling via the ok-set check in zipFiles.
		}
	}
	return ok;
}

/**
 * Picks only the manifest fields so download bytes never leak into it.
 * Videos downloaded separately get their localPath rewritten to the
 * sibling folder they actually landed in.
 *
 * @param {unknown} raw
 * @param {Set<string>} separateOk URLs downloaded as individual files.
 * @param {string} separateDir
 * @returns {{ tweetId: string, url: string, type: string, localPath?: string, mime?: string, unresolved?: string }[]}
 */
function manifestItems(raw, separateOk, separateDir) {
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
		if (typeof item.localPath !== "string" || typeof item.mime !== "string") {
			return { ...picked, unresolved: "missing-bytes" };
		}
		if (separateOk.has(picked.url)) {
			return {
				...picked,
				localPath: separateDir + item.localPath.split("/").pop(),
				mime: item.mime,
			};
		}
		return { ...picked, localPath: item.localPath, mime: item.mime };
	});
}

/**
 * @param {import("./model.js").ThreadSnapshot} snapshot
 * @param {Record<string, object>} manifest
 * @param {unknown[]} zipMedia Raw items selected for bundling.
 * @param {Set<string>} separateOk URLs already downloaded separately.
 * @returns {{ name: string, text?: string, base64?: string, sheet?: { columns: string[], rows: string[][] } }[]}
 */
function zipFiles(snapshot, manifest, zipMedia, separateOk) {
	const /** @type {{ name: string, text?: string, base64?: string, sheet?: { columns: string[], rows: string[][] } }[]} */ files =
			[
				{ name: "thread.json", text: JSON.stringify(snapshot, null, 2) },
				{
					name: "media-manifest.json",
					text: JSON.stringify(manifest, null, 2),
				},
				{ name: "thread.html", text: renderThreadHtml(snapshot) },
				{ name: "thread.md", text: renderThreadMarkdown(snapshot) },
				{ name: "thread.csv", text: snapshotToCsv(snapshot) },
				{
					name: "thread.xlsx",
					sheet: {
						columns: [...THREAD_COLUMNS],
						rows: snapshotToRows(snapshot).slice(1),
					},
				},
			];
	for (const entry of zipMedia ?? []) {
		const item = /** @type {Record<string, unknown>} */ (entry ?? {});
		if (
			typeof item.localPath === "string" &&
			typeof item.base64 === "string" &&
			!separateOk.has(String(item.url ?? ""))
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
