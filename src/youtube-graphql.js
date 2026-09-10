/**
 * YouTube network response parser (Phase 6, jalur B). The ONLY file allowed
 * to read YouTube payload shapes — timedtext json3, captionTracks, videoDetails.
 * Fields absent from the payload stay empty, never guessed. Works on captured
 * response bodies; the content script only forwards buffers, never parses.
 *
 * Corrupt/foreign bodies always yield the empty shape, never throw: API is
 * strictly an upgrade path, the honest-empty result stands on its own.
 */

/**
 * @typedef {Object} VideoSegment
 * @property {string} t Verbatim "mm:ss" timestamp for minute references.
 * @property {number} seconds Derived floor(tStartMs / 1000).
 * @property {string} text Joined segment text, trimmed, never empty.
 */

/**
 * @typedef {Object} VideoTrack
 * @property {string} languageCode
 * @property {string} name Human label, "" when absent.
 * @property {string} vssId ".xx" manual, "a.xx" auto.
 * @property {string} kind "asr" for auto tracks, "" for manual.
 */

/**
 * @typedef {Object} VideoMeta
 * @property {string} videoId
 * @property {string} title
 * @property {number} durationSeconds 0 when unparseable.
 * @property {string} author
 */

/**
 * Parses JSON defensively: anything unparseable becomes {}.
 *
 * @param {unknown} body
 * @returns {Record<string, unknown>}
 */
function parseBody(body) {
	if (typeof body !== "string" || body === "") {
		return {};
	}
	try {
		const parsed = JSON.parse(body);
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

/**
 * Narrows unknown JSON to a record. Single choke point so nested
 * traversal stays readable without cast clutter.
 *
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
	return /** @type {Record<string, unknown>} */ (
		value && typeof value === "object" ? value : {}
	);
}

/**
 * @param {unknown} ms
 * @returns {string} "mm:ss", "" when not a finite number.
 */
function stampText(ms) {
	if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
		return "";
	}
	const total = Math.floor(ms / 1000);
	const minutes = String(Math.floor(total / 60)).padStart(2, "0");
	const seconds = String(total % 60).padStart(2, "0");
	return `${minutes}:${seconds}`;
}

/**
 * Reads timedtext events in document order. Events without usable text
 * are skipped (they carry window/style setup, not captions); multi-seg
 * events join their utf8 parts in order.
 *
 * @param {unknown} body Captured /api/timedtext response body.
 * @returns {VideoSegment[]}
 */
export function extractSegments(body) {
	const events = asRecord(parseBody(body)).events;
	if (!Array.isArray(events)) {
		return [];
	}
	const segments = [];
	for (const raw of events) {
		const event = asRecord(raw);
		const stamp = stampText(event.tStartMs);
		if (stamp === "" || !Array.isArray(event.segs)) {
			continue;
		}
		const text = event.segs
			.map((seg) => asRecord(seg).utf8)
			.filter((part) => typeof part === "string")
			.join("")
			.trim();
		if (text === "") {
			continue;
		}
		segments.push({
			t: stamp,
			seconds: Math.floor(/** @type {number} */ (event.tStartMs) / 1000),
			text,
		});
	}
	return segments;
}

/**
 * Lists caption tracks from a player response. Absent captions = []:
 * the honest "this video has no captions" signal.
 *
 * @param {unknown} body Captured /youtubei/v1/player response body.
 * @returns {VideoTrack[]}
 */
export function extractTracks(body) {
	const captions = asRecord(asRecord(parseBody(body)).captions);
	const renderer = asRecord(captions.playerCaptionsTracklistRenderer);
	const tracks = renderer.captionTracks;
	if (!Array.isArray(tracks)) {
		return [];
	}
	return tracks.map((raw) => {
		const track = asRecord(raw);
		const name = asRecord(track.name).simpleText;
		return {
			languageCode:
				typeof track.languageCode === "string" ? track.languageCode : "",
			name: typeof name === "string" ? name : "",
			vssId: typeof track.vssId === "string" ? track.vssId : "",
			kind: track.kind === "asr" ? "asr" : "",
		};
	});
}

/**
 * @param {unknown} body Captured /youtubei/v1/player response body.
 * @returns {VideoMeta}
 */
export function extractVideoMeta(body) {
	const details = asRecord(asRecord(parseBody(body)).videoDetails);
	const duration = Number.parseInt(
		typeof details.lengthSeconds === "string" ? details.lengthSeconds : "",
		10,
	);
	return {
		videoId: typeof details.videoId === "string" ? details.videoId : "",
		title: typeof details.title === "string" ? details.title : "",
		durationSeconds: Number.isFinite(duration) ? duration : 0,
		author: typeof details.author === "string" ? details.author : "",
	};
}

/**
 * @typedef {Object} VideoPayload
 * @property {string} videoId Page URL wins, player body is the fallback.
 * @property {string} title
 * @property {string} url Watch URL as opened.
 * @property {number} durationSeconds
 * @property {string} lang Manual track language first, else first track, else "".
 * @property {VideoSegment[]} segments In capture order, never re-sorted.
 */

/**
 * Extracts the watch id. Short links (`youtu.be/<id>`) work too;
 * anything else yields "" and the caller falls back honestly.
 *
 * @param {unknown} url
 * @returns {string}
 */
function videoIdFromUrl(url) {
	const match =
		typeof url === "string"
			? url.match(/[?&]v=([A-Za-z0-9_-]{11})|youtu\.be\/([A-Za-z0-9_-]{11})/)
			: null;
	return match?.[1] ?? match?.[2] ?? "";
}

/**
 * Assembles one payload from captured buffers. First timed body with real
 * segments wins (newest capture first — mirrors timelineApiBodies order);
 * meta and tracks come from the first player body with an identity.
 * Missing pieces stay empty, never guessed.
 *
 * @param {unknown} timedBodies Newest-first /api/timedtext bodies.
 * @param {unknown} playerBodies Newest-first /youtubei/v1/player bodies.
 * @param {unknown} url Watch URL as opened.
 * @returns {VideoPayload}
 */
export function assembleVideoPayload(timedBodies, playerBodies, url) {
	const timed = Array.isArray(timedBodies) ? timedBodies : [];
	const players = Array.isArray(playerBodies) ? playerBodies : [];
	let segments = /** @type {VideoSegment[]} */ ([]);
	for (const body of timed) {
		const parsed = extractSegments(body);
		if (parsed.length > 0) {
			segments = parsed;
			break;
		}
	}
	let meta = extractVideoMeta("");
	let tracks = /** @type {VideoTrack[]} */ ([]);
	for (const body of players) {
		const candidate = extractVideoMeta(body);
		if (candidate.videoId !== "") {
			meta = candidate;
			tracks = extractTracks(body);
			break;
		}
	}
	const manual = tracks.find((track) => track.kind !== "asr");
	return {
		videoId: videoIdFromUrl(url) || meta.videoId,
		title: meta.title,
		url: typeof url === "string" ? url : "",
		durationSeconds: meta.durationSeconds,
		lang: manual?.languageCode ?? tracks[0]?.languageCode ?? "",
		segments,
	};
}
