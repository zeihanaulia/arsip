import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Regression cover for the honest-empty contract on the YouTube path.
 *
 * The bug this pins: a captioned long video reported EMPTY_TRANSCRIPT
 * ("some videos have no captions at all") because the caption body was
 * dropped upstream. A missed capture dressed as an honest-empty sends
 * the user hunting for a setting that does not exist, so the three
 * outcomes must stay distinguishable.
 *
 * Drives the worker through its real message listener, so no test-only
 * export has to be added to src/.
 *
 * @param {Record<string, unknown>} payload Tab's SCRAPE_START answer.
 * @returns {Promise<string>} The SCRAPE_ERROR code the popup would show.
 */
async function downloadTranscript(payload) {
	/** @type {((message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean | undefined)[]} */
	const listeners = [];
	globalThis.chrome = /** @type {typeof chrome} */ (
		/** @type {unknown} */ ({
			runtime: {
				onMessage: {
					addListener: (/** @type {unknown} */ fn) => {
						listeners.push(
							/** @type {(message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean | undefined} */ (
								fn
							),
						);
					},
				},
			},
			tabs: {
				// The worker relays to the tab; answer with the fixture
				// payload so the test exercises assembly and the error
				// decision only.
				query: async () => [{ id: 1 }],
				sendMessage: async () => ({ type: "SCRAPE_DONE", payload }),
			},
			downloads: { download: async () => 1 },
		})
	);
	// Fresh module instance per call: the worker keeps result state in
	// module memory, so a cached import would leak between cases.
	await import(`../src/background.js?video=${Math.random()}`);
	const listener = listeners[0];
	if (!listener) {
		throw new Error("background did not register a listener");
	}
	return await transcriptCode(listener);
}

/**
 * SCRAPE_START answers "started" immediately and reports the real outcome
 * through STATUS — the same two-step contract the popup polls. Bounded
 * retries, so a stalled worker fails the test instead of hanging it.
 *
 * @param {(message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean | undefined} listener
 * @returns {Promise<string>} The SCRAPE_ERROR code the popup would show.
 */
function transcriptCode(listener) {
	const started = Date.now();
	/** @returns {Promise<string>} */
	const poll = () =>
		new Promise((resolve) => {
			listener({ type: "SCRAPE_STATUS", payload: {} }, {}, resolve);
		}).then((status) => {
			const code =
				/** @type {{ payload?: { result?: { payload?: { code?: string } } } }} */ (
					status
				).payload?.result?.payload?.code;
			if (code) {
				return code;
			}
			return Date.now() - started > 5_000
				? "TIMED_OUT"
				: new Promise((wait) => setTimeout(wait, 10)).then(poll);
		});
	listener(
		{ type: "SCRAPE_START", payload: { site: "youtube" } },
		{},
		() => {},
	);
	return poll();
}

describe("downloadVideo empty-transcript codes", () => {
	it("reports an honest EMPTY_TRANSCRIPT when the video has no captions", async () => {
		const result = await downloadTranscript({
			timedBodies: [],
			playerBodies: [
				JSON.stringify({
					videoDetails: { videoId: "cQWMhMNYllQ", title: "No subs" },
					captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
				}),
			],
			sourceUrl: "https://www.youtube.com/watch?v=cQWMhMNYllQ",
		});

		assert.equal(result, "EMPTY_TRANSCRIPT");
	});

	it("reports CAPTURE_MISSED when captions exist but nothing was captured", async () => {
		const result = await downloadTranscript({
			timedBodies: [],
			playerBodies: [
				JSON.stringify({
					videoDetails: { videoId: "cQWMhMNYllQ", title: "Has subs" },
					captions: {
						playerCaptionsTracklistRenderer: {
							captionTracks: [
								{
									baseUrl:
										"https://www.youtube.com/api/timedtext?v=cQWMhMNYllQ",
									name: { simpleText: "English" },
									vssId: ".en",
									languageCode: "en",
								},
							],
						},
					},
				}),
			],
			sourceUrl: "https://www.youtube.com/watch?v=cQWMhMNYllQ",
		});

		assert.equal(result, "CAPTURE_MISSED");
	});

	it("reports CAPTURE_UNKNOWN when only heartbeats were captured", async () => {
		const heartbeat = JSON.stringify({
			playabilityStatus: { status: "OK" },
			pollDelayMs: 5000,
		});
		const result = await downloadTranscript({
			timedBodies: [],
			playerBodies: [heartbeat, heartbeat, heartbeat],
			sourceUrl: "https://www.youtube.com/watch?v=cQWMhMNYllQ",
		});

		assert.equal(result, "CAPTURE_UNKNOWN");
	});
});
