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
