import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { chromium } from "playwright";

const manifest = JSON.parse(
	readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
);
const hook = readFileSync(
	new URL("../src/hook-main.js", import.meta.url),
	"utf8",
);

describe("network receiver startup", () => {
	it("retains a response before the document body exists", async (t) => {
		const browser = await chromium.launch({ headless: true });
		t.after(() => browser.close());
		const page = await browser.newPage();
		const receiver = manifest.content_scripts.find(
			/** @param {{ matches: string[], js: string[] }} entry */
			(entry) =>
				entry.matches.includes("https://x.com/*") &&
				entry.js.includes("src/content.js"),
		);
		// Simulate the manifest's injection phase, not unconditional early injection:
		// reverting run_at must reproduce the empty log, even though the hook runs.
		const install = receiver.js
			.map(
				/** @param {string} file */
				(file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
			)
			.join("\n;\n");
		await page.addInitScript({
			content: `
				window.__messageListener = null;
				window.chrome = { runtime: {
					onMessage: { addListener(fn) { window.__messageListener = fn; } },
					sendMessage: async () => ({})
				} };
				window.fetch = async () => new Response('{"data":{"early":true}}', {
					headers: { "Content-Type": "application/json" }
				});
				${hook}
				${receiver.run_at === "document_start" ? install : ""}
			`,
		});
		await page.route("https://x.com/startup-fixture", (route) =>
			route.fulfill({
				contentType: "text/html",
				body: `<!doctype html><html><head><script>
					window.__bodyAtResponse = !!document.body;
					fetch("https://api.x.com/graphql/fixture/TweetDetail");
				</script></head><body>ready</body></html>`,
			}),
		);
		await page.goto("https://x.com/startup-fixture");
		if (receiver.run_at !== "document_start") {
			await page.addScriptTag({ content: install });
		}
		const result = await page.evaluate(() => {
			const state =
				/** @type {{ __bodyAtResponse?: boolean, __messageListener?: (message: object, sender: object, respond: (value: { payload: { log: { body: string }[] } }) => void) => void }} */ (
					/** @type {unknown} */ (window)
				);
			let log = /** @type {{ body: string }[]} */ ([]);
			state.__messageListener?.(
				{ type: "DUMP_NETWORK", payload: {} },
				{},
				(value) => {
					log = value.payload.log;
				},
			);
			return { bodyExisted: state.__bodyAtResponse, log };
		});
		assert.equal(result.bodyExisted, false);
		assert.equal(result.log.length, 1, "initial response must survive startup");
		assert.deepEqual(JSON.parse(result.log[0].body), {
			data: { early: true },
		});
	});
});
