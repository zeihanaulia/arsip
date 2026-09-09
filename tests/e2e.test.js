import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { renderThreadHtml } from "../src/export-html.js";
import { createThreadSnapshot, createTweet } from "../src/model.js";

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

	it("reports injected capabilities on PING so stale tabs are visible", async (t) => {
		const browser = await chromium.launch({ headless: !headed });
		t.after(() => browser.close());

		async function pingWith(
			/** @type {string[]} */ scripts,
			/** @type {boolean} */ mainHook,
		) {
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
				pathToFileURL(join(root, "tests/fixtures/thread.html")).href,
			);
			for (const script of scripts) {
				await page.addScriptTag({ path: join(root, script) });
			}
			if (mainHook) {
				// Runs in the MAIN world like the real hook; the isolated
				// content script must still observe it through shared DOM.
				await page.evaluate(() => {
					document.documentElement.setAttribute("data-arsip-hook", "main");
				});
			}
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
					listener({ type: "PING", payload: {} }, {}, resolve);
				});
			});
			await page.close();
			return /** @type {{ payload?: Record<string, unknown> }} */ (response)
				.payload;
		}

		const full = await pingWith(
			[
				"src/x-adapter.js",
				"src/scroller.js",
				"vendor/jszip.min.js",
				"vendor/xlsx.full.min.js",
				"src/media.js",
				"src/content.js",
			],
			true,
		);
		const stale = await pingWith(["src/x-adapter.js", "src/content.js"], false);

		assert.deepEqual(full?.caps, {
			hook: true,
			scroller: true,
			media: true,
			zip: true,
			sheet: true,
		});
		assert.deepEqual(stale?.caps, {
			hook: false,
			scroller: false,
			media: false,
			zip: false,
			sheet: false,
		});
	});

	it("still answers DONE when the expand phase throws", async (t) => {
		const browser = await chromium.launch({ headless: !headed });
		t.after(() => browser.close());
		const page = await browser.newPage();
		const /** @type {unknown[]} */ posted = [];
		await page.exposeFunction(
			"recordProgress",
			(/** @type {unknown} */ message) => {
				posted.push(message);
			},
		);
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
						sendMessage: async (/** @type {unknown} */ message) => {
							const bridge =
								/** @type {{ recordProgress?: (message: unknown) => Promise<unknown> }} */ (
									globalThis
								);
							await bridge.recordProgress?.(message);
							return {};
						},
					},
				},
			});
		});
		await page.goto(
			pathToFileURL(join(root, "tests/fixtures/thread.html")).href,
		);
		await page.addScriptTag({ path: join(root, "src/x-adapter.js") });
		await page.addScriptTag({
			content:
				"globalThis.XScroller = { expandAndScroll: async () => { throw new Error('boom'); } };",
		});
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
					{ type: "SCRAPE_START", payload: { autoScroll: true } },
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
		assert.ok(
			posted.some(
				(message) =>
					/** @type {{ payload?: Record<string, unknown> }} */ (message).payload
						?.expandError === "boom",
			),
			"expand error must be reported, not swallowed",
		);
	});

	it("answers DONE with scrollerMissing when autoScroll has no scroller", async (t) => {
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
			pathToFileURL(join(root, "tests/fixtures/thread.html")).href,
		);
		// NOTE: x-adapter.js only — no scroller.js, like a stale tab.
		await page.addScriptTag({ path: join(root, "src/x-adapter.js") });
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
					{ type: "SCRAPE_START", payload: { autoScroll: true } },
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
		assert.equal(payload.payload?.scrollerMissing, true);
		assert.ok(
			/** @type {unknown[]} */ (payload.payload?.tweets ?? []).length > 0,
			"viewport tweets still scraped",
		);
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

	it("handles real X player markup: amplify poster plus blob source", async (t) => {
		const browser = await chromium.launch({ headless: !headed });
		t.after(() => browser.close());
		const page = await browser.newPage();
		await page.goto(
			pathToFileURL(join(root, "tests/fixtures/thread-video-real.html")).href,
		);
		await page.addScriptTag({ path: join(root, "src/x-adapter.js") });

		const result = await page.evaluate(() =>
			globalThis.XAdapter.scrapeRaw(document, location.href),
		);

		assert.equal(result.tweets.length, 1);
		assert.deepEqual(result.tweets[0].media, [
			{
				url: "https://pbs.twimg.com/amplify_video_thumb/2096853248754016256/img/oadTg8Y6i25lhlZc.jpg",
				type: "photo",
			},
			{
				url: "blob:https://x.com/27f73faf-7e12-4921-a7e4-19f8ad396f0e",
				type: "video",
			},
		]);
	});

	it("mounts lazy players by scrolling tweets into view", async (t) => {
		const browser = await chromium.launch({ headless: !headed });
		t.after(() => browser.close());
		const page = await browser.newPage();
		await page.goto(
			pathToFileURL(join(root, "tests/fixtures/thread-lazy.html")).href,
		);
		await page.addScriptTag({ path: join(root, "src/x-adapter.js") });
		await page.addScriptTag({ path: join(root, "src/scroller.js") });

		const before = await page.evaluate(
			() =>
				globalThis.XAdapter.scrapeRaw(document, location.href).tweets[0].media,
		);
		await page.evaluate(() => globalThis.XScroller.mountLazyMedia(document));
		const after = await page.evaluate(
			() =>
				globalThis.XAdapter.scrapeRaw(document, location.href).tweets[0].media,
		);

		assert.deepEqual(before, []);
		assert.deepEqual(after, [
			{
				url: "https://pbs.twimg.com/amplify_video_thumb/1/img/a.jpg",
				type: "photo",
			},
			{ url: "blob:https://x.com/lazy-uuid", type: "video" },
		]);
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
			const blobBytes = await page.evaluate(async () => {
				const url = URL.createObjectURL(
					new Blob(["hello"], { type: "text/plain" }),
				);
				const fetched = await globalThis.XMedia.fetchBytes(url);
				URL.revokeObjectURL(url);
				return fetched;
			});
			const playlistVerdict = await page.evaluate(() =>
				globalThis.XMedia.isFetchable("https://video.twimg.com/list.m3u8"),
			);

			assert.equal(fetched.mime, "image/png");
			assert.ok(fetched.base64.length > 0);
			assert.equal(blobVerdict, true);
			assert.equal(blobBytes.mime, "text/plain");
			assert.equal(playlistVerdict, false);
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

	it("builds thread.xlsx from sheet entries with the vendored SheetJS", async (t) => {
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
		await page.addScriptTag({ path: join(root, "vendor/xlsx.full.min.js") });
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
							files: [
								{
									name: "thread.xlsx",
									sheet: {
										columns: ["Tweet Id", "Full Text"],
										rows: [["1", 'a, "b"']],
									},
								},
							],
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

		const sheet = await page.evaluate(
			async (zip) => {
				const vendor = /** @type {{ JSZip?: unknown, XLSX?: unknown }} */ (
					globalThis
				);
				const zipLoader =
					/** @type {{ loadAsync: (data: string, options: object) => Promise<{ file: (name: string) => { async: (kind: string) => Promise<string> } | null }> }} */ (
						vendor.JSZip
					);
				const sheetLib =
					/** @type {{ read: (data: string, options: object) => { Sheets: Record<string, unknown>, SheetNames: string[] }, utils: { sheet_to_json: (ws: unknown, options: object) => unknown[][] } }} */ (
						vendor.XLSX
					);
				const loaded = await zipLoader.loadAsync(zip, { base64: true });
				const file = loaded.file("thread.xlsx");
				if (!file) {
					throw new Error("thread.xlsx missing from archive");
				}
				const workbook = sheetLib.read(await file.async("base64"), {
					type: "base64",
				});
				return sheetLib.utils.sheet_to_json(
					workbook.Sheets[workbook.SheetNames[0]],
					{ header: 1 },
				);
			},
			/** @type {string} */ (payload.payload?.zipBase64),
		);

		assert.deepEqual(sheet, [
			["Tweet Id", "Full Text"],
			["1", 'a, "b"'],
		]);
	});

	describe("hook-main (real Chromium)", () => {
		it("captures stub fetch and XHR JSON without breaking them", async (t) => {
			const browser = await chromium.launch({ headless: !headed });
			t.after(() => browser.close());
			const page = await browser.newPage();
			await page.goto(
				pathToFileURL(join(root, "tests/fixtures/thread.html")).href,
			);
			await page.addScriptTag({ path: join(root, "src/hook-main.js") });

			const captured = await page.evaluate(async () => {
				/** @type {unknown[]} */
				const seen = [];
				window.addEventListener("arsip:net", (event) => {
					seen.push(/** @type {CustomEvent} */ (event).detail);
				});
				const fetched = await (
					await fetch('data:application/json,{"hello":"fetch"}')
				).json();
				const xhrText = await new Promise((resolve, reject) => {
					const xhr = new XMLHttpRequest();
					xhr.open("GET", 'data:application/json,{"hello":"xhr"}');
					xhr.addEventListener("load", () => resolve(xhr.responseText));
					xhr.addEventListener("error", reject);
					xhr.send();
				});
				await new Promise((resolve) => setTimeout(resolve, 100));
				return { fetched, xhrText, seen };
			});

			assert.deepEqual(captured.fetched, { hello: "fetch" });
			assert.equal(captured.xhrText, '{"hello":"xhr"}');
			assert.equal(captured.seen.length, 2);
			assert.ok(
				captured.seen.every(
					(entry) =>
						/** @type {{ mime?: string, body?: string }} */ (entry).mime ===
							"application/json" &&
						typeof (/** @type {{ body?: unknown }} */ (entry).body) ===
							"string",
				),
			);
		});
	});

	it("scrolls the inner timeline container, not just the document", async (t) => {
		const browser = await chromium.launch({ headless: !headed });
		t.after(() => browser.close());
		const page = await browser.newPage();
		await page.goto(
			pathToFileURL(join(root, "tests/fixtures/thread-inner.html")).href,
		);
		await page.addScriptTag({ path: join(root, "src/x-adapter.js") });
		await page.addScriptTag({ path: join(root, "src/scroller.js") });

		await page.evaluate(() =>
			globalThis.XScroller.expandAndScroll(document, {
				maxBatches: 3,
				batchDelayMs: 10,
			}),
		);
		const scrolled = await page.evaluate(
			() => document.querySelector("#timeline")?.scrollTop ?? 0,
		);
		const count = await page.evaluate(
			() =>
				globalThis.XAdapter.scrapeRaw(document, location.href).tweets.length,
		);

		assert.ok(scrolled > 0, "inner container must be scrolled");
		assert.equal(count, 2);
		assert.ok(
			(
				await page.evaluate(() =>
					globalThis.XScroller.expandAndScroll(document, {
						maxBatches: 1,
						batchDelayMs: 10,
					}),
				)
			).scrollTarget.includes("timeline"),
			"scroll target recorded for diagnosis",
		);
	});

	it("accumulates tweets across batches instead of keeping the last scrape", async (t) => {
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
			pathToFileURL(join(root, "tests/fixtures/thread-recycle.html")).href,
		);
		await page.addScriptTag({ path: join(root, "src/x-adapter.js") });
		await page.addScriptTag({ path: join(root, "src/scroller.js") });
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
					{ type: "SCRAPE_START", payload: { autoScroll: true } },
					{},
					resolve,
				);
			});
		});
		const payload =
			/** @type {{ type?: string, payload?: Record<string, unknown> }} */ (
				response
			);
		const ids = /** @type {{ id?: unknown }[]} */ (
			payload.payload?.tweets ?? []
		).map((tweet) => tweet.id);

		assert.equal(payload.type, "SCRAPE_DONE");
		assert.deepEqual(ids, ["1", "2"]);
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
		assert.ok(stats.history.length > 0, "growth curve recorded");
		assert.equal(stats.history[stats.history.length - 1], 2);
	});

	it("renders the exported HTML offline from local media only", async (t) => {
		const dir = mkdtempSync(join(tmpdir(), "xdl-offline-"));
		writeFileSync(
			join(dir, "media-1-0.jpg"),
			Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
				"base64",
			),
		);
		const snapshot = createThreadSnapshot({
			sourceUrl: "https://x.com/a/status/1",
			tweets: [
				createTweet({
					id: "1",
					text: "Paper",
					url: "https://x.com/a/status/1",
					user: { screenName: "a" },
					media: [
						{
							url: "https://pbs.twimg.com/media/a.jpg",
							type: "photo",
							localPath: "media-1-0.jpg",
						},
					],
				}),
			],
		});
		writeFileSync(join(dir, "thread.html"), renderThreadHtml(snapshot));

		const browser = await chromium.launch({ headless: !headed });
		t.after(() => browser.close());
		const context = await browser.newContext();
		const page = await context.newPage();
		await page.goto(pathToFileURL(join(dir, "thread.html")).href);
		await context.setOffline(true);
		await page.reload();
		const width = await page.evaluate(
			() =>
				/** @type {HTMLImageElement | null} */ (document.querySelector("img"))
					?.naturalWidth ?? 0,
		);
		const text = await page.textContent("article");

		assert.ok(width > 0, "local image must render with no network");
		assert.ok(text?.includes("Paper"));
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
