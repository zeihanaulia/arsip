import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectAdapter, SITE_ADAPTERS } from "../src/sites/registry.js";

describe("detectAdapter", () => {
	it("routes X hosts to the x adapter", () => {
		assert.equal(detectAdapter("https://x.com/a/status/1"), "x");
		assert.equal(detectAdapter("https://twitter.com/a/status/1"), "x");
	});

	it("routes YouTube watch pages to the youtube adapter", () => {
		assert.equal(
			detectAdapter("https://www.youtube.com/watch?v=abc123DEF45"),
			"youtube",
		);
		assert.equal(
			detectAdapter("https://m.youtube.com/watch?v=abc123DEF45"),
			"youtube",
		);
	});

	it("returns null for unregistered sites", () => {
		assert.equal(detectAdapter("https://example.com/page"), null);
		assert.equal(
			detectAdapter("https://learning.oreilly.com/library/view/x"),
			null,
			"oreilly lives on its own branch, not on main",
		);
		assert.equal(detectAdapter("not a url"), null);
	});

	it("registers every adapter with its classic scripts", () => {
		for (const adapter of SITE_ADAPTERS) {
			assert.ok(adapter.id.length > 0);
			assert.ok(adapter.scripts.length > 0);
			assert.ok(adapter.scripts.every((file) => file.endsWith(".js")));
		}
	});
});
