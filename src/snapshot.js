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
 * Reduces WebVTT to speakable lines for LLM context: drops the header,
 * timestamps, cue settings, and voice tags. Duplicate consecutive lines
 * (karaoke-style repeats) collapse to one.
 *
 * @param {string} vtt
 * @returns {string}
 */
export function captionsToText(vtt) {
	const /** @type {string[]} */ lines = [];
	for (const rawLine of String(vtt ?? "").split(/\r?\n/)) {
		const line = rawLine.trim();
		if (
			line === "" ||
			line === "WEBVTT" ||
			line.includes("-->") ||
			/^(NOTE|STYLE|REGION)/.test(line)
		) {
			continue;
		}
		const clean = line
			.replace(/<[^>]*>/g, "")
			.replace(/\s+/g, " ")
			.trim();
		if (clean !== "" && clean !== lines[lines.length - 1]) {
			lines.push(clean);
		}
	}
	return lines.join("\n");
}

/**
 * @param {string} base64
 * @returns {string} UTF-8 text ("" when undecodable).
 */
export function base64ToText(base64) {
	try {
		const binary = atob(String(base64 ?? ""));
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) {
			bytes[i] = binary.charCodeAt(i);
		}
		return new TextDecoder().decode(bytes);
	} catch {
		return "";
	}
}

/**
 * Copies download results (localPath/unresolved) and decoded caption
 * text from raw media items onto the snapshot's tweet media, matched
 * by URL. Keeps every exporter on the single ThreadSnapshot contract.
 *
 * @param {import("./model.js").ThreadSnapshot} snapshot Mutated in place.
 * @param {unknown[]} rawMedia Content-script items (may carry base64).
 * @returns {import("./model.js").ThreadSnapshot} The same snapshot.
 */
export function enrichSnapshotMedia(snapshot, rawMedia) {
	const byUrl = new Map();
	for (const entry of rawMedia ?? []) {
		const item = /** @type {Record<string, unknown>} */ (entry ?? {});
		if (typeof item.url === "string" && item.url !== "") {
			byUrl.set(item.url, item);
		}
	}
	for (const tweet of snapshot?.tweets ?? []) {
		tweet.media = (tweet.media ?? []).map((media) => {
			const found = byUrl.get(media.url);
			return found ? mergeMediaEntry(media, found) : media;
		});
	}
	return snapshot;
}

/**
 * Merges one download result into one media entry: local path,
 * unresolved reason, and decoded caption text for subtitle files.
 *
 * @param {import("./model.js").TweetMedia} media
 * @param {Record<string, unknown>} found Raw content-script item.
 * @returns {import("./model.js").TweetMedia}
 */
function mergeMediaEntry(media, found) {
	const enriched = { ...media };
	if (typeof found.localPath === "string") {
		enriched.localPath = found.localPath;
	}
	if (typeof found.unresolved === "string") {
		enriched.unresolved = found.unresolved;
	}
	if (media.type === "captions" && typeof found.base64 === "string") {
		const text = captionsToText(base64ToText(found.base64));
		if (text !== "") {
			enriched.captionText = text;
		}
	}
	return enriched;
}

/**
 * True when the tweet the page was opened on is among the captured
 * tweets. False means the user opened a reply permalink and the ancestors
 * above the viewport never loaded — the honest signal for a "root
 * missing" hint instead of a silently headless thread.
 *
 * @param {import("./model.js").ThreadSnapshot} snapshot
 * @returns {boolean}
 */
export function isRootCaptured(snapshot) {
	const sourceId = /\/status\/(\d+)/.exec(snapshot?.sourceUrl ?? "")?.[1] ?? "";
	if (sourceId === "") {
		return true;
	}
	return (snapshot?.tweets ?? []).some((tweet) => tweet.id === sourceId);
}

/**
 * Builds the capture provenance block stored on the snapshot: why the
 * run stopped and under which options. Future 23-of-184 mysteries get
 * answered by reading the file instead of guessing.
 *
 * @param {Record<string, unknown>} [progress] Last scroller progress.
 * @param {{ autoScroll?: unknown, videoMode?: unknown, rootCaptured?: unknown }} [options]
 * @returns {{ stoppedWhy: string, batches: number, autoScroll: boolean, videoMode: string, rootCaptured: boolean }}
 */
export function captureStats(progress = {}, options = {}) {
	const stoppedWhy =
		typeof progress.stoppedWhy === "string" && progress.stoppedWhy !== ""
			? progress.stoppedWhy
			: "viewport-only";
	const batches = typeof progress.batches === "number" ? progress.batches : 0;
	const videoMode =
		options.videoMode === "separate" || options.videoMode === "posters-only"
			? options.videoMode
			: "bundle";
	return {
		stoppedWhy,
		batches,
		autoScroll: options.autoScroll === true,
		videoMode,
		rootCaptured: options.rootCaptured !== false,
	};
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
