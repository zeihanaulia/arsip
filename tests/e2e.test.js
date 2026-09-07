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
