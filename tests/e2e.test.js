import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const headed = process.env.HEADED === "1";

/**
 * Shape the adapter guarantees at runtime (parseTweet always fills
 * user/media/metrics). Cast from unknown because the browser boundary
 * is untyped; the asserts below verify it for real.
 *
 * @typedef {{ tweets: { id: string, text: string, user: { screenName: string, name: string }, createdAt: string, metrics: { likes: number, views: number }, media: { url: string, type: string }[] }[] }} ScrapeResult
 */

describe("x-adapter (real Chromium)", () => {
	it("scrapes the fixture thread end to end", async (t) => {
		const browser = await chromium.launch({ headless: !headed });
		t.after(() => browser.close());
		const page = await browser.newPage();
		await page.goto(
			pathToFileURL(join(root, "tests/fixtures/thread.html")).href,
		);
		await page.addScriptTag({ path: join(root, "src/x-adapter.js") });

		const result = /** @type {ScrapeResult} */ (
			/** @type {unknown} */ (
				await page.evaluate(() =>
					globalThis.XAdapter.scrapeRaw(document, location.href),
				)
			)
		);

		assert.deepEqual(
			result.tweets.map((tweet) => tweet.id),
			["2096302171243315378", "2096341610078384152", "2096357060401115275"],
		);
		assert.equal(result.tweets[0].text, "Paper on cognitive complexity");
		assert.equal(result.tweets[0].user.screenName, "asidorenko_");
		assert.equal(result.tweets[0].user.name, "Alex Sidorenko");
		assert.equal(result.tweets[0].createdAt, "2026-09-05T18:26:02.000Z");
		assert.equal(result.tweets[0].metrics.likes, 26);
		assert.equal(result.tweets[0].metrics.views, 4504);
		assert.deepEqual(result.tweets[2].media, [
			{
				url: "https://pbs.twimg.com/media/HRfBnXSaIAA-7TD.jpg",
				type: "photo",
			},
		]);
		assert.deepEqual(result.tweets[1].media, []);
	});

	it("answers SCRAPE_ERROR instead of hanging when the adapter is missing", async (t) => {
		const browser = await chromium.launch({ headless: !headed });
		t.after(() => browser.close());
		const page = await browser.newPage();
		await page.addInitScript(() => {
			const holder = /** @type {{ __listeners?: unknown[] }} */ (globalThis);
			holder.__listeners = [];
			Object.assign(globalThis, {
				chrome: {
					runtime: {
						onMessage: {
							addListener: (/** @type {unknown} */ fn) => {
								holder.__listeners?.push(fn);
							},
						},
					},
				},
			});
		});
		await page.goto(
			pathToFileURL(join(root, "tests/fixtures/thread.html")).href,
		);
		// NOTE: content.js without x-adapter.js — a stale tab looks like this.
		await page.addScriptTag({ path: join(root, "src/content.js") });

		const response = await page.evaluate(() => {
			const holder =
				/** @type {{ __listeners?: ((...args: unknown[]) => void)[] }} */ (
					globalThis
				);
			const listener = holder.__listeners?.[0];
			if (!listener) {
				throw new Error("content script did not register a listener");
			}
			return new Promise((resolve) => {
				listener({ type: "SCRAPE_START", payload: {} }, {}, resolve);
			});
		});

		assert.equal(
			/** @type {{ type?: string }} */ (response)?.type,
			"SCRAPE_ERROR",
		);
	});

	it("finds expand buttons and reads the conversation id from the URL", async (t) => {
		const browser = await chromium.launch({ headless: !headed });
		t.after(() => browser.close());
		const page = await browser.newPage();
		await page.goto(
			pathToFileURL(join(root, "tests/fixtures/thread-expand.html")).href,
		);
		await page.addScriptTag({ path: join(root, "src/x-adapter.js") });

		const buttons = await page.evaluate(
			() => globalThis.XAdapter.findExpandButtons(document).length,
		);
		const conversationId = await page.evaluate(() =>
			globalThis.XAdapter.conversationIdFromUrl(
				"https://x.com/asidorenko_/status/2096302171243315378",
			),
		);

		assert.equal(buttons, 1);
		assert.equal(conversationId, "2096302171243315378");
	});

	it("expands hidden replies until the timeline stops growing", async (t) => {
		const browser = await chromium.launch({ headless: !headed });
		t.after(() => browser.close());
		const page = await browser.newPage();
		await page.goto(
			pathToFileURL(join(root, "tests/fixtures/thread-expand.html")).href,
		);
		await page.addScriptTag({ path: join(root, "src/x-adapter.js") });
		await page.addScriptTag({ path: join(root, "src/scroller.js") });

		const before = await page.evaluate(
			() =>
				globalThis.XAdapter.scrapeRaw(document, location.href).tweets.length,
		);
		const stats = await page.evaluate(() =>
			globalThis.XScroller.expandAndScroll(document, {
				maxBatches: 5,
				batchDelayMs: 10,
			}),
		);
		const after = await page.evaluate(
			() =>
				globalThis.XAdapter.scrapeRaw(document, location.href).tweets.length,
		);

		assert.equal(before, 1);
		assert.equal(stats.clicked, 1);
		assert.equal(after, 2);
	});

	it("inventories photo posters and video sources without fetching", async (t) => {
		const browser = await chromium.launch({ headless: !headed });
		t.after(() => browser.close());
		const page = await browser.newPage();
		await page.goto(
			pathToFileURL(join(root, "tests/fixtures/thread-media.html")).href,
		);
		await page.addScriptTag({ path: join(root, "src/x-adapter.js") });

		const result = await page.evaluate(() =>
			globalThis.XAdapter.scrapeRaw(document, location.href),
		);

		assert.deepEqual(
			result.tweets.map((tweet) => tweet.id),
			["2096357060401115275", "2096341610078384152", "2096348582454481165"],
		);
		assert.deepEqual(result.tweets[0].media, [
			{
				url: "https://pbs.twimg.com/media/HRfBnXSaIAA-7TD.jpg",
				type: "photo",
			},
		]);
		assert.deepEqual(result.tweets[1].media, [
			{
				url: "https://pbs.twimg.com/media/Poster123.jpg",
				type: "photo",
			},
			{ url: "https://video.twimg.com/demo/video.mp4", type: "video" },
			{
				url: "https://video.twimg.com/demo/captions.en.vtt",
				type: "captions",
			},
		]);
		assert.deepEqual(result.tweets[2].media, [
			{
				url: "https://pbs.twimg.com/media/Poster456.jpg",
				type: "photo",
			},
			{ url: "blob:https://x.com/9d2b6c1a-uuid", type: "video" },
		]);
	});

	describe("XMedia (real Chromium)", () => {
		it("fetches bytes for http URLs and refuses blob streams", async (t) => {
			const browser = await chromium.launch({ headless: !headed });
			t.after(() => browser.close());
			const page = await browser.newPage();
			await page.goto(
				pathToFileURL(join(root, "tests/fixtures/thread-media.html")).href,
			);
			await page.addScriptTag({ path: join(root, "src/media.js") });

			const fetched = await page.evaluate(() =>
				globalThis.XMedia.fetchBytes(
					"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
				),
			);
			const blobVerdict = await page.evaluate(() =>
				globalThis.XMedia.isFetchable("blob:https://x.com/9d2b6c1a-uuid"),
			);
			const playlistVerdict = await page.evaluate(() =>
				globalThis.XMedia.isFetchable("https://video.twimg.com/list.m3u8"),
			);

			assert.equal(fetched.mime, "image/png");
			assert.ok(fetched.base64.length > 0);
			assert.equal(blobVerdict, false);
			assert.equal(playlistVerdict, false);
		});

		it("strips caption timestamps down to speakable lines", async (t) => {
			const browser = await chromium.launch({ headless: !headed });
			t.after(() => browser.close());
			const page = await browser.newPage();
			await page.goto(
				pathToFileURL(join(root, "tests/fixtures/thread-media.html")).href,
			);
			await page.addScriptTag({ path: join(root, "src/media.js") });

			const text = await page.evaluate(() =>
				globalThis.XMedia.captionsToText(
					"WEBVTT\n\n00:18.000 --> 00:20.000\nRealistically speaking, the code bases\n\n00:20.000 --> 00:22.000\n<v Speaker>that matter the most</v>\n",
				),
			);

			assert.equal(
				text,
				"Realistically speaking, the code bases\nthat matter the most",
			);
		});

		it("zips files with the vendored JSZip and reads them back", async (t) => {
			const browser = await chromium.launch({ headless: !headed });
			t.after(() => browser.close());
			const page = await browser.newPage();
			await page.goto(
				pathToFileURL(join(root, "tests/fixtures/thread-media.html")).href,
			);
			await page.addScriptTag({ path: join(root, "vendor/jszip.min.js") });
			await page.addScriptTag({ path: join(root, "src/media.js") });

			const files = await page.evaluate(async () => {
				const vendor = /** @type {{ JSZip?: unknown }} */ (globalThis);
				const JSZipClass =
					/** @type {new () => { file: (name: string, data: string, options?: object) => unknown, generateAsync: (options: object) => Promise<string> }} */ (
						vendor.JSZip
					);
				const zipBase64 = await globalThis.XMedia.buildZip(
					[
						{ name: "media/1-0.jpg", base64: "aGVsbG8=" },
						{ name: "thread.json", base64: "e30=" },
					],
					JSZipClass,
				);
				const loader =
					/** @type {{ loadAsync: (data: string, options: object) => Promise<{ files: Record<string, unknown> }> }} */ (
						vendor.JSZip
					);
				const loaded = await loader.loadAsync(zipBase64, {
					base64: true,
				});
				return Object.keys(loaded.files).filter((name) => !name.endsWith("/"));
			});

			assert.deepEqual(files, ["media/1-0.jpg", "thread.json"]);
		});

		it("maps mime types to safe local filenames", async (t) => {
			const browser = await chromium.launch({ headless: !headed });
			t.after(() => browser.close());
			const page = await browser.newPage();
			await page.goto(
				pathToFileURL(join(root, "tests/fixtures/thread-media.html")).href,
			);
			await page.addScriptTag({ path: join(root, "src/media.js") });

			const names = await page.evaluate(() => [
				globalThis.XMedia.localName("2096", 0, "https://x/y", "image/jpeg"),
				globalThis.XMedia.localName("2096", 1, "https://x/y", "video/mp4"),
				globalThis.XMedia.localName("a/b?c", 2, "https://x/y", ""),
			]);

			assert.deepEqual(names, [
				"media/2096-0.jpg",
				"media/2096-1.mp4",
				"media/a_b_c-2.bin",
			]);
		});
	});

	it("builds a zip on BUILD_ZIP without touching the network", async (t) => {
		const browser = await chromium.launch({ headless: !headed });
		t.after(() => browser.close());
		const page = await browser.newPage();
		await page.addInitScript(() => {
			const holder = /** @type {{ __listeners?: unknown[] }} */ (globalThis);
			holder.__listeners = [];
			Object.assign(globalThis, {
				chrome: {
					runtime: {
						onMessage: {
							addListener: (/** @type {unknown} */ fn) => {
								holder.__listeners?.push(fn);
							},
						},
						sendMessage: async () => ({}),
					},
				},
			});
		});
		await page.goto(
			pathToFileURL(join(root, "tests/fixtures/thread-media.html")).href,
		);
		await page.addScriptTag({ path: join(root, "vendor/jszip.min.js") });
		await page.addScriptTag({ path: join(root, "src/media.js") });
		await page.addScriptTag({ path: join(root, "src/content.js") });

		const response = await page.evaluate(() => {
			const holder =
				/** @type {{ __listeners?: ((...args: unknown[]) => void)[] }} */ (
					globalThis
				);
			const listener = holder.__listeners?.[0];
			if (!listener) {
				throw new Error("content script did not register a listener");
			}
			return new Promise((resolve) => {
				listener(
					{
						type: "BUILD_ZIP",
						payload: {
							files: [{ name: "thread.json", text: '{"tweets":[]}' }],
						},
					},
					{},
					resolve,
				);
			});
		});
		const payload =
			/** @type {{ type?: string, payload?: Record<string, unknown> }} */ (
				response
			);

		assert.equal(payload.type, "SCRAPE_DONE");
		const zipBase64 = /** @type {string} */ (payload.payload?.zipBase64);
		assert.ok(zipBase64.length > 0);
		const names = await page.evaluate((zip) => {
			const loader =
				/** @type {{ loadAsync: (data: string, options: object) => Promise<{ files: Record<string, unknown> }> }} */ (
					/** @type {unknown} */ (
						/** @type {{ JSZip?: unknown }} */ (globalThis).JSZip
					)
				);
			return loader
				.loadAsync(zip, { base64: true })
				.then((loaded) => Object.keys(loaded.files));
		}, zipBase64);
		assert.deepEqual(
			names.filter((name) => !name.endsWith("/")),
			["thread.json"],
		);
	});

	it("waits out a slow chunk instead of quitting while idle", async (t) => {
		const browser = await chromium.launch({ headless: !headed });
		t.after(() => browser.close());
		const page = await browser.newPage();
		await page.goto(
			pathToFileURL(join(root, "tests/fixtures/thread-expand-slow.html")).href,
		);
		await page.addScriptTag({ path: join(root, "src/x-adapter.js") });
		await page.addScriptTag({ path: join(root, "src/scroller.js") });

		const stats = await page.evaluate(() =>
			globalThis.XScroller.expandAndScroll(document),
		);
		const after = await page.evaluate(
			() =>
				globalThis.XAdapter.scrapeRaw(document, location.href).tweets.length,
		);

		assert.equal(after, 2);
		assert.equal(stats.stoppedWhy, "idle");
	});

	it("parses compact counts like 1.2K without guessing the rest", async (t) => {
		const browser = await chromium.launch({ headless: !headed });
		t.after(() => browser.close());
		const page = await browser.newPage();
		await page.goto(
			pathToFileURL(join(root, "tests/fixtures/thread.html")).href,
		);
		await page.addScriptTag({ path: join(root, "src/x-adapter.js") });

		const parsed = await page.evaluate(() =>
			globalThis.XAdapter.parseCount("1.2K"),
		);

		assert.equal(parsed, 1200);
	});
});
