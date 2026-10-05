import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	assembleVideoPayload,
	extractSegments,
	extractTracks,
	extractVideoMeta,
} from "../src/youtube-graphql.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(
	readFileSync(join(root, "tests/fixtures/timedtext-sample.json"), "utf8"),
);

describe("extractSegments", () => {
	it("reads ordered timestamped segments from a timedtext body", () => {
		const segments = extractSegments(JSON.stringify(fixture.timedtext));

		assert.ok(segments.length > 5);
		assert.equal(segments[0].t, "00:00");
		assert.equal(segments[0].seconds, 0);
		assert.match(segments[0].text, /Austin/);
		assert.ok(
			segments.every((segment) => /^\d{2,}:\d{2}$/.test(segment.t)),
			"timestamps stay verbatim mm:ss",
		);
	});

	it("skips empty events and joins multi-seg events in order", () => {
		const segments = extractSegments(JSON.stringify(fixture.timedtext));

		assert.ok(segments.every((segment) => segment.text !== ""));
		assert.ok(
			segments.every((segment) => /^\d{2,}:\d{2}$/.test(segment.t)),
			"timestamps stay verbatim mm:ss",
		);
	});

	it("returns [] for corrupt or foreign bodies without throwing", () => {
		for (const body of [
			"",
			"{broken",
			"{}",
			"[]",
			'{"events":"nope"}',
			'{"events":[{"tStartMs":"x"}]}',
		]) {
			assert.deepEqual(extractSegments(body), []);
		}
	});
});

describe("extractTracks", () => {
	it("lists manual and auto tracks honestly", () => {
		const tracks = extractTracks(
			JSON.stringify({
				captions: {
					playerCaptionsTracklistRenderer: {
						captionTracks: fixture.captionTracks,
					},
				},
			}),
		);

		assert.equal(tracks.length, 2);
		assert.equal(tracks[0].languageCode, "en-US");
		assert.equal(tracks[0].vssId, ".en-US");
		assert.equal(tracks[1].kind, "asr");
	});

	it("returns [] when captions are absent without throwing", () => {
		for (const body of ["", "{broken", "{}", '{"captions":{}}']) {
			assert.deepEqual(extractTracks(body), []);
		}
	});
});

describe("extractVideoMeta", () => {
	it("reads video identity from a player body", () => {
		const meta = extractVideoMeta(
			JSON.stringify({ videoDetails: fixture.videoDetails }),
		);

		assert.equal(meta.videoId, "cQWMhMNYllQ");
		assert.equal(meta.title, "7uwRy67WVi");
		assert.equal(meta.durationSeconds, 1155);
		assert.equal(meta.author, "TpFGILdxnEQrD");
	});

	it("stays empty and honest for corrupt bodies", () => {
		assert.deepEqual(extractVideoMeta(""), {
			videoId: "",
			title: "",
			durationSeconds: 0,
			author: "",
		});
		assert.deepEqual(extractVideoMeta("{broken"), {
			videoId: "",
			title: "",
			durationSeconds: 0,
			author: "",
		});
	});
});

describe("assembleVideoPayload", () => {
	const timedBody = JSON.stringify(fixture.timedtext);
	const playerBody = JSON.stringify({
		videoDetails: fixture.videoDetails,
		captions: {
			playerCaptionsTracklistRenderer: {
				captionTracks: fixture.captionTracks,
			},
		},
	});
	const url = "https://www.youtube.com/watch?v=cQWMhMNYllQ";

	it("assembles title, segments, and track language from both bodies", () => {
		const video = assembleVideoPayload([timedBody], [playerBody], url);

		assert.equal(video.videoId, "cQWMhMNYllQ");
		assert.equal(video.title, "7uwRy67WVi");
		assert.equal(video.url, url);
		assert.equal(video.durationSeconds, 1155);
		assert.equal(video.lang, "en-US");
		assert.ok(video.segments.length > 5);
		assert.equal(video.segments[0].t, "00:00");
	});

	it("prefers the videoId from the page URL over the player body", () => {
		const video = assembleVideoPayload(
			[timedBody],
			[playerBody],
			"https://www.youtube.com/watch?v=AAAAAAAAAAA",
		);

		assert.equal(video.videoId, "AAAAAAAAAAA");
		assert.equal(video.url, "https://www.youtube.com/watch?v=AAAAAAAAAAA");
	});

	it("stays honest when bodies are missing or empty", () => {
		const video = assembleVideoPayload([], [], url);

		assert.deepEqual(video.segments, []);
		assert.equal(video.title, "");
		assert.equal(video.videoId, "cQWMhMNYllQ");
	});
});

/**
 * Heartbeat responses share the player endpoint but carry no
 * videoDetails at all. They must never pass for a player body that
 * declares this video has no captions — that distinction is the whole
 * point of captionState.
 *
 * @returns {string}
 */
function heartbeatBody() {
	return JSON.stringify({
		playabilityStatus: { status: "OK" },
		pollDelayMs: 5000,
	});
}

describe("assembleVideoPayload captionState", () => {
	const url = "https://www.youtube.com/watch?v=cQWMhMNYllQ";
	const playerBody = JSON.stringify({
		videoDetails: fixture.videoDetails,
		captions: {
			playerCaptionsTracklistRenderer: { captionTracks: fixture.captionTracks },
		},
	});
	const noCaptionsBody = JSON.stringify({
		videoDetails: fixture.videoDetails,
	});

	it("reports listed when the player declares tracks but no body arrived", () => {
		const video = assembleVideoPayload([], [playerBody], url);

		assert.equal(video.captionState, "listed");
		assert.deepEqual(video.segments, []);
	});

	it("reports absent only when a matching player body has no tracks", () => {
		const video = assembleVideoPayload([], [noCaptionsBody], url);

		assert.equal(video.captionState, "absent");
	});

	it("reports unknown for heartbeat-only bodies instead of absent", () => {
		const video = assembleVideoPayload(
			[],
			[heartbeatBody(), heartbeatBody(), heartbeatBody()],
			url,
		);

		assert.equal(video.captionState, "unknown");
		assert.equal(video.title, "");
	});

	it("reports unknown when no player body was captured at all", () => {
		assert.equal(assembleVideoPayload([], [], url).captionState, "unknown");
	});
});

describe("assembleVideoPayload player body selection", () => {
	const url = "https://www.youtube.com/watch?v=cQWMhMNYllQ";
	const otherVideo = JSON.stringify({
		videoDetails: {
			...fixture.videoDetails,
			videoId: "AAAAAAAAAAA",
			title: "other",
		},
		captions: {
			playerCaptionsTracklistRenderer: { captionTracks: fixture.captionTracks },
		},
	});
	const matching = JSON.stringify({
		videoDetails: fixture.videoDetails,
		captions: {
			playerCaptionsTracklistRenderer: { captionTracks: fixture.captionTracks },
		},
	});

	it("skips heartbeats and other videos to find this page's player body", () => {
		// Newest-first, exactly what the tab forwards: heartbeats arrive
		// after the real response and must not crowd it out.
		const video = assembleVideoPayload(
			[],
			[heartbeatBody(), heartbeatBody(), heartbeatBody(), matching, otherVideo],
			url,
		);

		assert.equal(video.captionState, "listed");
		assert.equal(video.title, fixture.videoDetails.title);
		assert.equal(video.durationSeconds, 1155);
	});

	it("never borrows metadata from a different video", () => {
		const video = assembleVideoPayload([], [otherVideo], url);

		assert.equal(video.title, "");
		assert.equal(video.durationSeconds, 0);
		assert.equal(video.captionState, "unknown");
		assert.equal(video.videoId, "cQWMhMNYllQ");
	});
});
