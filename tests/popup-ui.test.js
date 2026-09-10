import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const headed = process.env.HEADED === "1";

describe("popup UI (stubbed chrome APIs)", () => {
	it("wires download to polling status with no console errors", async (t) => {
		const browser = await chromium.launch({
			headless: !headed,
			args: ["--allow-file-access-from-files"],
		});
		t.after(() => browser.close());
		const page = await browser.newPage();
		const /** @type {string[]} */ problems = [];
		page.on("console", (message) => {
			if (message.type() === "error") {
				problems.push(message.text());
			}
		});
		page.on("pageerror", (error) => {
			problems.push(String(error));
		});
		await page.addInitScript(() => {
			let polls = 0;
			const chromeStub = {
				tabs: {
					query: async () => [{ id: 7, url: "https://x.com/a/status/1" }],
					sendMessage: async () => ({
						type: "PING",
						payload: { connected: true },
					}),
				},
				runtime: {
					sendMessage: async (/** @type {unknown} */ message) => {
						const type = /** @type {{ type?: string }} */ (message)?.type;
						if (type === "SCRAPE_START") {
							return {
								type: "SCRAPE_PROGRESS",
								payload: { phase: "started" },
							};
						}
						if (type === "SCRAPE_STATUS") {
							polls += 1;
							if (polls < 2) {
								return {
									type: "SCRAPE_PROGRESS",
									payload: {
										phase: "expanding",
										tweets: 2,
										batches: 1,
										result: null,
									},
								};
							}
							return {
								type: "SCRAPE_PROGRESS",
								payload: {
									phase: "scraping",
									tweets: 3,
									batches: 2,
									result: {
										type: "SCRAPE_DONE",
										payload: {
											filename: "x-thread-1-2026-09-07.json",
											count: 3,
											stoppedWhy: "idle",
											batches: 2,
										},
									},
								},
							};
						}
						return { type: "SCRAPE_DONE", payload: { cancelled: true } };
					},
				},
			};
			Object.assign(globalThis, { chrome: chromeStub });
		});
		await page.goto(pathToFileURL(join(root, "src/popup.html")).href);

		assert.equal(await page.textContent("h3"), "Arsip");
		assert.equal(await page.isDisabled("#cancel"), true);
		const modes = await page.$eval("#videomode", (select) =>
			[.../** @type {HTMLSelectElement} */ (select).options].map(
				(option) => option.value,
			),
		);
		assert.deepEqual(modes, ["bundle", "separate", "posters-only"]);
		assert.equal(
			await page.$eval(
				"#videomode",
				(select) => /** @type {HTMLSelectElement} */ (select).value,
			),
			"separate",
		);
		await page.check("#autoscroll");
		await page.click("#download");
		await page.waitForFunction(
			() =>
				document.querySelector("#status")?.textContent?.includes("downloaded"),
			{ timeout: 15_000 },
		);

		const status = await page.textContent("#status");
		assert.match(status ?? "", /3 tweets/);
		assert.match(status ?? "", /stopped: idle/);
		assert.equal(
			await page.$eval(
				"#progress",
				(bar) => /** @type {HTMLProgressElement} */ (bar).hidden,
			),
			true,
		);
		await page.screenshot({ path: join(tmpdir(), "xdl-popup.png") });
		assert.deepEqual(problems, []);
	});

	it("downloads the network log on demand", async (t) => {
		const browser = await chromium.launch({
			headless: !headed,
			args: ["--allow-file-access-from-files"],
		});
		t.after(() => browser.close());
		const page = await browser.newPage();
		const /** @type {string[]} */ problems = [];
		page.on("console", (message) => {
			if (message.type() === "error") {
				problems.push(message.text());
			}
		});
		page.on("pageerror", (error) => {
			problems.push(String(error));
		});
		await page.addInitScript(() => {
			Object.assign(globalThis, {
				chrome: {
					tabs: {
						query: async () => [{ id: 7, url: "https://x.com/a/status/1" }],
					},
					runtime: {
						sendMessage: async () => ({
							type: "SCRAPE_DONE",
							payload: { filename: "network-log.json", entries: 4 },
						}),
					},
				},
			});
		});
		await page.goto(pathToFileURL(join(root, "src/popup.html")).href);

		await page.evaluate(() => {
			document.querySelector("#advanced")?.setAttribute("open", "");
		});
		await page.click("#netlog");
		await page.waitForFunction(
			() =>
				document
					.querySelector("#status")
					?.textContent?.includes("network-log.json"),
			{ timeout: 15_000 },
		);

		const status = await page.textContent("#status");
		assert.match(status ?? "", /4 entries/);
		assert.deepEqual(problems, []);
	});

	it("allows the network log on YouTube while downloads stay X-only", async (t) => {
		const browser = await chromium.launch({
			headless: !headed,
			args: ["--allow-file-access-from-files"],
		});
		t.after(() => browser.close());
		const page = await browser.newPage();
		const /** @type {string[]} */ problems = [];
		page.on("console", (message) => {
			if (message.type() === "error") {
				problems.push(message.text());
			}
		});
		page.on("pageerror", (error) => {
			problems.push(String(error));
		});
		await page.addInitScript(() => {
			Object.assign(globalThis, {
				chrome: {
					tabs: {
						query: async () => [
							{ id: 9, url: "https://www.youtube.com/watch?v=abc123DEF45" },
						],
					},
					runtime: {
						sendMessage: async () => ({
							type: "SCRAPE_DONE",
							payload: { filename: "network-log.json", entries: 4 },
						}),
					},
				},
			});
		});
		await page.goto(pathToFileURL(join(root, "src/popup.html")).href);

		await page.evaluate(() => {
			document.querySelector("#advanced")?.setAttribute("open", "");
		});
		await page.click("#netlog");
		await page.waitForFunction(
			() =>
				document
					.querySelector("#status")
					?.textContent?.includes("network-log.json"),
			{ timeout: 15_000 },
		);
		const status = await page.textContent("#status");
		assert.match(status ?? "", /4 entries/);
		assert.deepEqual(problems, []);
	});

	it("refuses non-X sites with an explicit message instead of a channel error", async (t) => {
		const browser = await chromium.launch({
			headless: !headed,
			args: ["--allow-file-access-from-files"],
		});
		t.after(() => browser.close());
		const page = await browser.newPage();
		const /** @type {string[]} */ problems = [];
		page.on("console", (message) => {
			if (message.type() === "error") {
				problems.push(message.text());
			}
		});
		page.on("pageerror", (error) => {
			problems.push(String(error));
		});
		await page.addInitScript(() => {
			Object.assign(globalThis, {
				chrome: {
					tabs: {
						query: async () => [{ id: 9, url: "https://example.com/page" }],
					},
					runtime: {
						sendMessage: async () => {
							throw new Error("must never send on unsupported sites");
						},
					},
				},
			});
		});
		await page.goto(pathToFileURL(join(root, "src/popup.html")).href);

		await page.click("#download");
		await page.waitForFunction(
			() =>
				document
					.querySelector("#status")
					?.textContent?.includes("hanya mendukung"),
			{ timeout: 15_000 },
		);

		const status = await page.textContent("#status");
		assert.match(status ?? "", /hanya mendukung/);
		assert.deepEqual(problems, []);
	});

	it("sends the selected preset with custom formats", async (t) => {
		const browser = await chromium.launch({
			headless: !headed,
			args: ["--allow-file-access-from-files"],
		});
		t.after(() => browser.close());
		const page = await browser.newPage();
		const /** @type {string[]} */ problems = [];
		page.on("console", (message) => {
			if (message.type() === "error") {
				problems.push(message.text());
			}
		});
		page.on("pageerror", (error) => {
			problems.push(String(error));
		});
		await page.addInitScript(() => {
			/** @type {unknown[]} */
			const sent = [];
			Object.assign(globalThis, {
				__sent: sent,
				chrome: {
					tabs: {
						query: async () => [{ id: 7, url: "https://x.com/a/status/1" }],
					},
					runtime: {
						sendMessage: async (/** @type {unknown} */ message) => {
							sent.push(message);
							const type = /** @type {{ type?: string }} */ (message)?.type;
							if (type === "SCRAPE_STATUS") {
								return {
									type: "SCRAPE_PROGRESS",
									payload: {
										phase: "done",
										result: {
											type: "SCRAPE_DONE",
											payload: { filename: "x.zip", count: 1 },
										},
									},
								};
							}
							return {
								type: "SCRAPE_PROGRESS",
								payload: { phase: "started" },
							};
						},
					},
				},
			});
		});
		await page.goto(pathToFileURL(join(root, "src/popup.html")).href);

		assert.equal(
			await page.$eval(
				"#preset",
				(select) => /** @type {HTMLSelectElement} */ (select).value,
			),
			"llm",
		);
		await page.selectOption("#preset", "custom");
		await page.uncheck("#fmt-html");
		await page.uncheck("#fmt-json");
		await page.uncheck("#fmt-xlsx");
		await page.click("#download");
		await page.waitForFunction(
			() => document.querySelector("#status")?.textContent?.includes("x.zip"),
			{ timeout: 15_000 },
		);

		const sent = await page.evaluate(
			() =>
				/** @type {unknown[]} */ (
					/** @type {{ __sent?: unknown }} */ (globalThis).__sent ?? []
				),
		);
		const started = sent.find(
			(message) =>
				/** @type {{ type?: string }} */ (message)?.type === "SCRAPE_START",
		);
		assert.deepEqual(/** @type {{ payload?: unknown }} */ (started)?.payload, {
			site: "x",
			autoScroll: false,
			videoMode: "separate",
			preset: "custom",
			formats: ["thread.md", "thread.csv"],
			skipPromoted: true,
		});
		assert.deepEqual(problems, []);
	});

	it("downloads a transcript on YouTube and sends site routing", async (t) => {
		const browser = await chromium.launch({
			headless: !headed,
			args: ["--allow-file-access-from-files"],
		});
		t.after(() => browser.close());
		const page = await browser.newPage();
		const /** @type {string[]} */ problems = [];
		page.on("console", (message) => {
			if (message.type() === "error") {
				problems.push(message.text());
			}
		});
		page.on("pageerror", (error) => {
			problems.push(String(error));
		});
		await page.addInitScript(() => {
			/** @type {unknown[]} */
			const sent = [];
			Object.assign(globalThis, {
				__sent: sent,
				chrome: {
					tabs: {
						query: async () => [
							{ id: 9, url: "https://www.youtube.com/watch?v=cQWMhMNYllQ" },
						],
					},
					runtime: {
						sendMessage: async (/** @type {unknown} */ message) => {
							sent.push(message);
							const type = /** @type {{ type?: string }} */ (message)?.type;
							if (type === "SCRAPE_STATUS") {
								return {
									type: "SCRAPE_PROGRESS",
									payload: {
										phase: "done",
										result: {
											type: "SCRAPE_DONE",
											payload: {
												kind: "video",
												filename: "cQWMhMNYllQ.zip",
												count: 42,
											},
										},
									},
								};
							}
							return {
								type: "SCRAPE_PROGRESS",
								payload: { phase: "started" },
							};
						},
					},
				},
			});
		});
		await page.goto(pathToFileURL(join(root, "src/popup.html")).href);

		assert.equal(await page.textContent("#download"), "Download transcript");
		await page.click("#download");
		await page.waitForFunction(
			() =>
				document
					.querySelector("#status")
					?.textContent?.includes("cQWMhMNYllQ.zip"),
			{ timeout: 15_000 },
		);
		const status = await page.textContent("#status");
		assert.match(status ?? "", /42 segments/);

		const sent = await page.evaluate(
			() =>
				/** @type {unknown[]} */ (
					/** @type {{ __sent?: unknown }} */ (globalThis).__sent ?? []
				),
		);
		const started = sent.find(
			(message) =>
				/** @type {{ type?: string }} */ (message)?.type === "SCRAPE_START",
		);
		assert.equal(
			/** @type {{ payload?: { site?: string } }} */ (started)?.payload?.site,
			"youtube",
		);
		assert.deepEqual(problems, []);
	});

	it("reports a YouTube tab healthy without the X-only caps", async (t) => {
		const browser = await chromium.launch({
			headless: !headed,
			args: ["--allow-file-access-from-files"],
		});
		t.after(() => browser.close());
		const page = await browser.newPage();
		const /** @type {string[]} */ problems = [];
		page.on("console", (message) => {
			if (message.type() === "error") {
				problems.push(message.text());
			}
		});
		page.on("pageerror", (error) => {
			problems.push(String(error));
		});
		await page.addInitScript(() => {
			Object.assign(globalThis, {
				chrome: {
					tabs: {
						query: async () => [
							{ id: 9, url: "https://www.youtube.com/watch?v=cQWMhMNYllQ" },
						],
						sendMessage: async () => ({
							type: "PING",
							payload: {
								connected: true,
								caps: { hook: true, zip: true },
							},
						}),
					},
					runtime: {
						sendMessage: async () => ({}),
					},
				},
			});
		});
		await page.goto(pathToFileURL(join(root, "src/popup.html")).href);

		await page.click("#ping");
		await page.waitForFunction(
			() =>
				document.querySelector("#status")?.textContent?.includes("connected:"),
			{ timeout: 15_000 },
		);

		assert.equal(await page.textContent("#status"), "connected: true");
		assert.deepEqual(problems, []);
	});
});
