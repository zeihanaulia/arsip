import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MESSAGE_TYPES } from "../src/messaging.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

describe("manifest", () => {
	it("is a Manifest V3 extension", () => {
		assert.equal(manifest.manifest_version, 3);
		assert.ok(manifest.name.length > 0);
		assert.ok(manifest.version.length > 0);
	});

	it("requests only the minimal permissions from the intent", () => {
		const allowed = new Set(["activeTab", "scripting", "downloads"]);

		for (const permission of manifest.permissions ?? []) {
			assert.ok(
				allowed.has(permission),
				`unexpected permission: ${permission}`,
			);
		}
		assert.ok(!manifest.host_permissions, "host_permissions must stay absent");
	});

	it("injects the content script on X and wires popup plus worker", () => {
		const /** @type {string[]} */ matches = (
				manifest.content_scripts ?? []
			).flatMap((/** @type {{ matches?: string[] }} */ s) => s.matches ?? []);

		assert.ok(
			matches.some((m) => m.includes("x.com")),
			"must match x.com",
		);
		assert.ok(manifest.action?.default_popup, "popup must be wired");
		assert.ok(manifest.background?.service_worker, "worker must be wired");
	});

	it("declares the worker as a module so its static imports load", () => {
		assert.equal(manifest.background?.type, "module");
	});

	it("keeps content scripts classic-safe (no static import/export)", () => {
		const /** @type {string[]} */ files = (
				manifest.content_scripts ?? []
			).flatMap((/** @type {{ js?: string[] }} */ s) => s.js ?? []);
		assert.ok(files.length > 0, "at least one content script expected");

		for (const /** @type {string} */ file of files) {
			const source = readFileSync(join(root, file), "utf8");
			assert.ok(!/^\s*import\s/m.test(source), `${file} must not use import`);
			assert.ok(!/^\s*export\s/m.test(source), `${file} must not use export`);
		}
	});

	it("pins the content-script vocabulary to messaging.js", () => {
		const /** @type {string[]} */ files = (
				manifest.content_scripts ?? []
			).flatMap((/** @type {{ js?: string[] }} */ s) => s.js ?? []);
		const sources = files.map((/** @type {string} */ file) =>
			readFileSync(join(root, file), "utf8"),
		);

		for (const type of Object.values(MESSAGE_TYPES)) {
			assert.ok(
				sources.some((source) => source.includes(`"${type}"`)),
				`content scripts must mirror message type ${type}`,
			);
		}
	});
});
