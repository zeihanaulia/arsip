import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateSnapshot } from "../src/model.js";
import {
	archiveFilenameForSnapshot,
	assembleSnapshot,
	assignThreadRelations,
	buildMediaManifest,
	filenameForSnapshot,
	separateDirForArchive,
	snapshotToDataUrl,
	splitMediaForMode,
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

describe("assignThreadRelations", () => {
	it("fills conversationId from the thread URL for every tweet", () => {
		const snapshot = assembleSnapshot(
			[RAW_ROOT, RAW_REPLY],
			"https://x.com/asidorenko_/status/2096302171243315378",
		);

		const related = assignThreadRelations(
			snapshot.tweets,
			"https://x.com/asidorenko_/status/2096302171243315378",
		);

		assert.ok(related.every((t) => t.conversationId === "2096302171243315378"));
		assert.equal(related[0].replyTo, null);
		assert.equal(related[0].inferred, false);
	});

	it("marks DOM-order relations as inferred instead of guessing parents", () => {
		const snapshot = assembleSnapshot(
			[RAW_ROOT, RAW_REPLY],
			"https://x.com/asidorenko_/status/2096302171243315378",
		);

		const related = assignThreadRelations(
			snapshot.tweets,
			"https://x.com/asidorenko_/status/2096302171243315378",
		);

		assert.equal(related[1].replyTo, null);
		assert.equal(related[1].inferred, true);
	});

	it("falls back to the first tweet when the URL carries no status id", () => {
		const snapshot = assembleSnapshot([RAW_ROOT, RAW_REPLY], RAW_ROOT.url);

		const related = assignThreadRelations(
			snapshot.tweets,
			"https://x.com/home",
		);

		assert.ok(related.every((t) => t.conversationId === RAW_ROOT.id));
		assert.ok(related.every((t) => t.inferred));
	});
});

describe("buildMediaManifest", () => {
	it("maps every inventoried URL to a local path or an honest unresolved reason", () => {
		const manifest = buildMediaManifest([
			{
				tweetId: "1",
				url: "https://pbs.twimg.com/media/a.jpg",
				type: "photo",
				localPath: "media/1-0.jpg",
				mime: "image/jpeg",
			},
			{
				tweetId: "2",
				url: "blob:https://x.com/uuid",
				type: "video",
				unresolved: "blob-stream",
			},
		]);

		assert.deepEqual(manifest, {
			"https://pbs.twimg.com/media/a.jpg": {
				tweetId: "1",
				type: "photo",
				localPath: "media/1-0.jpg",
				mime: "image/jpeg",
			},
			"blob:https://x.com/uuid": {
				tweetId: "2",
				type: "video",
				unresolved: "blob-stream",
			},
		});
	});
});

describe("archiveFilenameForSnapshot", () => {
	it("swaps the json extension for zip on the same base name", () => {
		const snapshot = assembleSnapshot([RAW_ROOT], RAW_ROOT.url);

		assert.equal(
			archiveFilenameForSnapshot(snapshot),
			filenameForSnapshot(snapshot).replace(/\.json$/, ".zip"),
		);
		assert.match(
			archiveFilenameForSnapshot(snapshot),
			/^x-thread-2096302171243315378-\d{4}-\d{2}-\d{2}\.zip$/,
		);
	});
});

describe("splitMediaForMode", () => {
	const photo = {
		tweetId: "1",
		url: "https://pbs.twimg.com/media/a.jpg",
		type: "photo",
		localPath: "media/1-0.jpg",
		base64: "AAA",
	};
	const video = {
		tweetId: "2",
		url: "https://video.twimg.com/v.mp4",
		type: "video",
		localPath: "media/2-0.mp4",
		base64: "BBB",
	};
	const stream = {
		tweetId: "3",
		url: "blob:https://x.com/u",
		type: "video",
		unresolved: "blob-stream",
	};

	it("bundles everything by default", () => {
		const split = splitMediaForMode([photo, video, stream], "bundle");

		assert.deepEqual(split.separate, []);
		assert.deepEqual(split.zip, [photo, video, stream]);
	});

	it("sends downloaded videos separate, keeps photos and captions bundled", () => {
		const split = splitMediaForMode([photo, video, stream], "separate");

		assert.deepEqual(split.separate, [video]);
		assert.deepEqual(split.zip, [photo, stream]);
	});

	it("falls back to bundle on unknown modes", () => {
		const split = splitMediaForMode([photo, video], "nope");

		assert.deepEqual(split.separate, []);
		assert.deepEqual(split.zip, [photo, video]);
	});
});

describe("separateDirForArchive", () => {
	it("derives a sibling folder from the archive name", () => {
		assert.equal(
			separateDirForArchive("x-thread-1-2026-09-07.zip"),
			"x-thread-1-2026-09-07-media/",
		);
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
