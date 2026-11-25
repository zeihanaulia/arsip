import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";

/**
 * @typedef {import("../src/messaging.js").Message} Message
 * @typedef {(message: Message, sender: object, respond: (value: Message) => void) => unknown} Listener
 */

/**
 * Drive the worker's actual START → STATUS → ZIP path. Only Chrome I/O
 * is stubbed; snapshot assembly, API parsing and exporters run for real.
 * @param {Record<string, unknown>} payload
 */
async function downloadThread(payload) {
	/** @type {Listener[]} */
	const listeners = [];
	/** @type {{ name: string, text?: string }[]} */
	let files = [];
	let downloads = 0;
	const originalChrome = globalThis.chrome;
	globalThis.chrome = /** @type {typeof chrome} */ (
		/** @type {unknown} */ ({
			runtime: {
				onMessage: {
					addListener: (/** @type {Listener} */ listener) =>
						listeners.push(listener),
				},
			},
			tabs: {
				query: async () => [{ id: 1 }],
				sendMessage: async (
					/** @type {number} */ _id,
					/** @type {Message} */ message,
				) => {
					if (message.type === "BUILD_ZIP") {
						files = /** @type {typeof files} */ (message.payload.files);
						return { type: "SCRAPE_DONE", payload: { zipBase64: "UEs=" } };
					}
					return { type: "SCRAPE_DONE", payload };
				},
			},
			downloads: {
				download: async () => {
					downloads += 1;
					return 1;
				},
			},
		})
	);
	try {
		await import(`../src/background.js?thread=${Math.random()}`);
		const listener = listeners[0];
		assert.ok(listener);
		listener(
			{ type: "SCRAPE_START", payload: { preset: "llm" } },
			{},
			() => {},
		);
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const status = await new Promise(
				/** @param {(value: Message) => void} resolve */
				(resolve) =>
					listener({ type: "SCRAPE_STATUS", payload: {} }, {}, resolve),
			);
			const result = /** @type {Message | null} */ (status.payload.result);
			if (result) {
				return { result, files, downloads };
			}
			await setTimeout(10);
		}
		throw new Error("worker did not finish");
	} finally {
		globalThis.chrome = originalChrome;
	}
}

describe("thread download without DOM tweets", () => {
	const sourceUrl = "https://x.com/satyanadella/status/2108213283144810958";
	it("exports the article captured by network even when the DOM is empty", async () => {
		const api = readFileSync(
			new URL("./fixtures/x-article-detail.json", import.meta.url),
			"utf8",
		);
		const { result, files, downloads } = await downloadThread({
			sourceUrl,
			tweets: [],
			api: [api],
		});
		assert.equal(result.type, "SCRAPE_DONE", JSON.stringify(result.payload));
		assert.equal(result.payload.rootCaptured, true);
		assert.equal(downloads, 1);
		const md = files.find((file) => file.name === "thread.md")?.text;
		assert.ok(md?.includes("The Infinite SaaS Factory"));
		assert.ok(md?.includes("The opportunity is to reinvent"));
	});

	it("still rejects a capture when both DOM and network have no tweets", async () => {
		const { result, downloads } = await downloadThread({
			sourceUrl,
			tweets: [],
			api: ["invalid JSON", '{"data":{}}'],
		});
		assert.equal(result.type, "SCRAPE_ERROR");
		assert.equal(result.payload.code, "EMPTY_THREAD");
		assert.equal(downloads, 0);
	});
});
