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
 * Fetches bytes with a timeout and a byte budget. Large videos must
 * fail fast (too-large/timeout) instead of stalling the whole scrape
 * while gigabytes download into a message channel.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number, maxBytes?: number }} [options]
 * @returns {Promise<FetchedBytes>}
 */
async function fetchBytes(url, options = {}) {
	const { timeoutMs = 30_000, maxBytes = 21_000_000 } = options;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) {
			throw new Error(`media fetch failed: ${response.status} for ${url}`);
		}
		const mime = (response.headers.get("content-type") ?? "")
			.split(";")[0]
			.trim();
		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error(`media body unreadable for ${url}`);
		}
		const chunks = [];
		let total = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			total += value.length;
			if (total > maxBytes) {
				await reader.cancel().catch(() => {});
				throw new Error("media-too-large");
			}
			chunks.push(value);
		}
		const merged = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			merged.set(chunk, offset);
			offset += chunk.length;
		}
		return { base64: bytesToBase64(merged), mime };
	} finally {
		clearTimeout(timer);
	}
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
	fetchBytes,
	isFetchable,
	localName,
};
