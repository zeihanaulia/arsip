import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateSnapshot } from "../src/model.js";
import {
	assembleSnapshot,
	filenameForSnapshot,
	snapshotToDataUrl,
} from "../src/snapshot.js";

const RAW_ROOT = {
	id: "2096302171243315378",
	text: "Paper on cognitive complexity",
	url: "https://x.com/asidorenko_/status/2096302171243315378",
	createdAt: "2026-09-05T18:26:02.000Z",
	user: { screenName: "asidorenko_", name: "Alex Sidorenko" },
	metrics: { likes: 26 },
};

const RAW_REPLY = {
	id: "2096341610078384152",
	text: "@asidorenko_ isn't this cyclomatic complexity?",
	url: "https://x.com/gabimoncha/status/2096341610078384152",
	createdAt: "2026-09-05T20:56:02.000Z",
	user: { screenName: "gabimoncha" },
};

describe("assembleSnapshot", () => {
	it("turns raw adapter output into a valid snapshot", () => {
		const snapshot = assembleSnapshot(
			[RAW_ROOT, RAW_REPLY],
			"https://x.com/asidorenko_/status/2096302171243315378",
			"2026-09-07T08:47:04.748Z",
		);

		assert.deepEqual(validateSnapshot(snapshot), []);
		assert.equal(snapshot.tweets.length, 2);
		assert.equal(snapshot.tweets[0].metrics.likes, 26);
		assert.equal(snapshot.tweets[1].user.screenName, "gabimoncha");
	});

	it("dedups double-rendered tweets, keeping DOM order", () => {
		const snapshot = assembleSnapshot(
			[RAW_ROOT, RAW_REPLY, { ...RAW_ROOT }],
			"https://x.com/a/status/1",
		);

		assert.deepEqual(
			snapshot.tweets.map((t) => t.id),
			[RAW_ROOT.id, RAW_REPLY.id],
		);
	});

	it("drops raw entries without an id instead of guessing", () => {
		const snapshot = assembleSnapshot(
			[{ ...RAW_ROOT, id: "" }, RAW_REPLY],
			"https://x.com/a/status/1",
		);

		assert.deepEqual(
			snapshot.tweets.map((t) => t.id),
			[RAW_REPLY.id],
		);
	});
});

describe("snapshotToDataUrl", () => {
	it("round-trips through base64 back to a valid snapshot", () => {
		const snapshot = assembleSnapshot(
			[RAW_ROOT, RAW_REPLY],
			"https://x.com/asidorenko_/status/2096302171243315378",
		);

		const url = snapshotToDataUrl(snapshot);

		assert.match(url, /^data:application\/json;base64,/);
		const json = Buffer.from(url.split(",")[1] ?? "", "base64").toString(
			"utf8",
		);
		const parsed = JSON.parse(json);
		assert.deepEqual(validateSnapshot(parsed), []);
		assert.equal(parsed.tweets.length, 2);
	});
});

describe("filenameForSnapshot", () => {
	it("builds a safe filename from the thread id and date", () => {
		const snapshot = assembleSnapshot([RAW_ROOT], RAW_ROOT.url);

		assert.match(
			filenameForSnapshot(snapshot),
			/^x-thread-2096302171243315378-\d{4}-\d{2}-\d{2}\.json$/,
		);
	});
});
