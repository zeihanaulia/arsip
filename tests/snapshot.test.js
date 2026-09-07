import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateSnapshot } from "../src/model.js";
import {
	archiveFilenameForSnapshot,
	assembleSnapshot,
	assignThreadRelations,
	base64ToText,
	buildMediaManifest,
	captionsToText,
	enrichSnapshotMedia,
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

describe("captionsToText", () => {
	it("strips header, timestamps, tags, and karaoke repeats", () => {
		assert.equal(
			captionsToText(
				"WEBVTT\n\n00:18.000 --> 00:20.000\nRealistically speaking, the code bases\n\n00:20.000 --> 00:22.000\n<v Speaker>that matter the most</v>\n00:22.000 --> 00:24.000\nthat matter the most\n",
			),
			"Realistically speaking, the code bases\nthat matter the most",
		);
	});

	it("returns empty string for empty input", () => {
		assert.equal(captionsToText(""), "");
	});
});

describe("base64ToText", () => {
	it("decodes base64 into utf8 text", () => {
		assert.equal(base64ToText("aGVsbG8="), "hello");
	});
});

describe("enrichSnapshotMedia", () => {
	it("attaches local paths and decoded captions by URL", () => {
		const snapshot = assembleSnapshot(
			[
				{
					id: "1",
					text: "t",
					url: "https://x.com/a/status/1",
					media: [
						{ url: "https://pbs.twimg.com/m/a.jpg", type: "photo" },
						{ url: "https://video.twimg.com/c.vtt", type: "captions" },
					],
				},
			],
			"https://x.com/a/status/1",
		);

		enrichSnapshotMedia(snapshot, [
			{
				url: "https://pbs.twimg.com/m/a.jpg",
				localPath: "media/1-0.jpg",
				mime: "image/jpeg",
			},
			{
				url: "https://video.twimg.com/c.vtt",
				localPath: "media/1-1.vtt",
				mime: "text/vtt",
				base64: Buffer.from(
					"WEBVTT\n\n00:01 --> 00:02\nMark\n",
					"utf8",
				).toString("base64"),
			},
		]);

		assert.equal(snapshot.tweets[0].media[0].localPath, "media/1-0.jpg");
		assert.equal(snapshot.tweets[0].media[1].localPath, "media/1-1.vtt");
		assert.equal(snapshot.tweets[0].media[1].captionText, "Mark");
	});

	it("leaves unknown URLs untouched", () => {
		const snapshot = assembleSnapshot([RAW_ROOT], RAW_ROOT.url);

		enrichSnapshotMedia(snapshot, []);

		assert.equal(snapshot.tweets[0].media.length, 0);
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
