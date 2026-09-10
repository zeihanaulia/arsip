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
