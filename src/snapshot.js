/**
 * Turns raw adapter output into a validated ThreadSnapshot (Task 2).
 * Imported by the service worker, which can use modules.
 */
import {
	createThreadSnapshot,
	createTweet,
	validateSnapshot,
} from "./model.js";

/**
 * @param {import("./model.js").TweetInput[]} rawTweets Adapter output; entries without an id are dropped.
 * @param {string} sourceUrl
 * @param {string} [scrapedAt]
 * @returns {import("./model.js").ThreadSnapshot}
 */
export function assembleSnapshot(rawTweets, sourceUrl, scrapedAt) {
	const tweets = [];
	const seen = new Set();
	for (const raw of rawTweets ?? []) {
		const id = typeof raw?.id === "string" ? raw.id.trim() : "";
		if (id === "" || seen.has(id)) {
			continue;
		}
		seen.add(id);
		tweets.push(createTweet({ ...raw, id }));
	}
	return createThreadSnapshot({
		sourceUrl,
		scrapedAt: scrapedAt ?? new Date().toISOString(),
		tweets,
	});
}

/**
 * Fills thread relations honestly: conversationId from the thread URL
 * (falling back to the first tweet), replyTo only when the adapter
 * already knows it. Everything derived from DOM order is flagged
 * inferred so exporters never mistake position for parenthood.
 *
 * @param {import("./model.js").Tweet[]} tweets
 * @param {string} sourceUrl
 * @returns {import("./model.js").Tweet[]}
 */
export function assignThreadRelations(tweets, sourceUrl) {
	const fromUrl = /\/status\/(\d+)/.exec(sourceUrl ?? "")?.[1] ?? "";
	const conversationId = fromUrl !== "" ? fromUrl : (tweets[0]?.id ?? "");
	return (tweets ?? []).map((tweet) => {
		const isCertainRoot = fromUrl !== "" && tweet.id === conversationId;
		return {
			...tweet,
			conversationId,
			replyTo: tweet.replyTo ?? null,
			inferred: tweet.replyTo != null ? tweet.inferred : !isCertainRoot,
		};
	});
}

/**
 * Builds the media manifest: every inventoried URL maps to either a
 * local path (downloaded) or an unresolved reason (blob stream, HLS
 * playlist, fetch failure). Nothing is silently dropped.
 *
 * @param {{ tweetId: string, url: string, type: string, localPath?: string, mime?: string, unresolved?: string }[]} items
 * @returns {Record<string, object>}
 */
export function buildMediaManifest(items) {
	const /** @type {Record<string, object>} */ manifest = {};
	for (const item of items ?? []) {
		if (!item || typeof item.url !== "string" || item.url === "") {
			continue;
		}
		if (item.unresolved) {
			manifest[item.url] = {
				tweetId: item.tweetId,
				type: item.type,
				unresolved: item.unresolved,
			};
		} else {
			manifest[item.url] = {
				tweetId: item.tweetId,
				type: item.type,
				localPath: item.localPath ?? "",
				mime: item.mime ?? "",
			};
		}
	}
	return manifest;
}

/**
 * Splits inventoried media by download mode. Photos and captions always
 * stay bundled; downloaded videos go separate only in "separate" mode.
 * Unknown modes fall back to "bundle" (single artifact, previous behavior).
 *
 * @param {unknown[]} rawMedia
 * @param {string} mode
 * @returns {{ zip: unknown[], separate: unknown[] }}
 */
export function splitMediaForMode(rawMedia, mode) {
	const list = Array.isArray(rawMedia) ? rawMedia : [];
	if (mode !== "separate") {
		return { zip: [...list], separate: [] };
	}
	const zip = [];
	const separate = [];
	for (const entry of list) {
		const item =
			/** @type {{ unresolved?: unknown, type?: unknown, base64?: unknown }} */ (
				entry ?? {}
			);
		if (
			!item.unresolved &&
			item.type === "video" &&
			typeof item.base64 === "string"
		) {
			separate.push(entry);
		} else {
			zip.push(entry);
		}
	}
	return { zip, separate };
}

/**
 * @param {string} archiveFilename e.g. "x-thread-1-2026-09-07.zip".
 * @returns {string} e.g. "x-thread-1-2026-09-07-media/".
 */
export function separateDirForArchive(archiveFilename) {
	return `${String(archiveFilename ?? "").replace(/\.zip$/, "")}-media/`;
}

/**
 * @param {import("./model.js").ThreadSnapshot} snapshot
 * @returns {string} Same base name as the JSON export, with a zip extension.
 */
export function archiveFilenameForSnapshot(snapshot) {
	return filenameForSnapshot(snapshot).replace(/\.json$/, ".zip");
}

/**
 * @param {import("./model.js").ThreadSnapshot} snapshot
 * @returns {string} Filesystem-safe download name.
 */
export function filenameForSnapshot(snapshot) {
	const firstId = snapshot.tweets[0]?.id ?? "unknown";
	const date = (snapshot.scrapedAt.slice(0, 10) || "undated").replace(
		/[^\d-]/g,
		"",
	);
	const safeId = firstId.replace(/[^A-Za-z0-9-_]/g, "_");
	return `x-thread-${safeId}-${date}.json`;
}

/**
 * Encodes the snapshot as a base64 data URL for `chrome.downloads`.
 * Service workers have no URL.createObjectURL, so a blob URL is not
 * an option in the background context.
 *
 * @param {import("./model.js").ThreadSnapshot} snapshot
 * @returns {string}
 */
export function snapshotToDataUrl(snapshot) {
	const bytes = new TextEncoder().encode(JSON.stringify(snapshot, null, 2));
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return `data:application/json;base64,${btoa(binary)}`;
}

export { validateSnapshot };
