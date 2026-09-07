/**
 * Media download helpers for the content script (Task 4).
 * Classic script on purpose, like x-adapter.js: exposes `XMedia` on
 * globalThis. Fetching happens here (tab context, login session);
 * zipping happens here too (page context has no createObjectURL limits
 * issues and JSZip loads as a classic script).
 */

/**
 * @typedef {Object} FetchedBytes
 * @property {string} base64
 * @property {string} mime
 */

const /** @type {Record<string, string>} */ MIME_EXTENSIONS = {
		"image/jpeg": "jpg",
		"image/png": "png",
		"image/gif": "gif",
		"image/webp": "webp",
		"video/mp4": "mp4",
		"text/vtt": "vtt",
	};

/**
 * Fetchable means "worth attempting". Same-tab blob: URLs are attempted
 * because the player that minted them shares our storage partition —
 * failures still land as unresolved, never as garbage. m3u8 playlists
 * are manifests, not media, and stay listed as unresolved.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isFetchable(url) {
	if (typeof url !== "string" || url === "") {
		return false;
	}
	if (/\.m3u8($|[?#])/i.test(url)) {
		return false;
	}
	return /^(https?|blob):/i.test(url);
}

/**
 * @param {string} url
 * @returns {Promise<FetchedBytes>}
 */
async function fetchBytes(url) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`media fetch failed: ${response.status} for ${url}`);
	}
	const mime = (response.headers.get("content-type") ?? "")
		.split(";")[0]
		.trim();
	const buffer = await response.arrayBuffer();
	return { base64: bytesToBase64(new Uint8Array(buffer)), mime };
}

/**
 * Reduces WebVTT to speakable lines for LLM context: drops the header,
 * timestamps, cue settings, and voice tags. Duplicate consecutive lines
 * (karaoke-style repeats) collapse to one.
 *
 * @param {string} vtt
 * @returns {string}
 */
function captionsToText(vtt) {
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
 * btoa on the whole buffer at once blows the stack for large files.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToBase64(bytes) {
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

/**
 * @param {string} tweetId
 * @param {number} index
 * @param {string} _url Reserved for future extension-based fallback.
 * @param {string} mime
 * @returns {string} e.g. "media/2096-0.jpg".
 */
function localName(tweetId, index, _url, mime) {
	const safeId = String(tweetId ?? "unknown").replace(/[^A-Za-z0-9-_]/g, "_");
	const ext = MIME_EXTENSIONS[mime] ?? "bin";
	return `media/${safeId}-${index}.${ext}`;
}

/**
 * @param {{ name: string, base64: string }[]} files
 * @param {{ new (): { file: (name: string, data: string, options?: object) => void, generateAsync: (options: object) => Promise<string> } }} JSZipClass Injected so tests control it.
 * @returns {Promise<string>} Base64-encoded ZIP.
 */
async function buildZip(files, JSZipClass) {
	const zip = new JSZipClass();
	for (const file of files ?? []) {
		zip.file(file.name, file.base64, { base64: true });
	}
	return zip.generateAsync({ type: "base64" });
}

globalThis.XMedia = {
	buildZip,
	bytesToBase64,
	captionsToText,
	fetchBytes,
	isFetchable,
	localName,
};
