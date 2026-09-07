import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	snapshotToCsv,
	snapshotToRows,
	THREAD_COLUMNS,
	tweetToRow,
} from "../src/export-tabular.js";
import { createThreadSnapshot, createTweet } from "../src/model.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const expectedHeaders = JSON.parse(
	readFileSync(join(root, "tests/fixtures/xcomments-headers.json"), "utf8"),
);

function sampleSnapshot() {
	const rootTweet = createTweet({
		id: "1",
		text: 'Hello, "world" — see https://t.co/abc and #demo @friend',
		url: "https://x.com/a/status/1",
		createdAt: "2026-09-05T18:26:02.000Z",
		conversationId: "1",
		user: {
			id: "10",
			name: "Alex",
			screenName: "a",
			avatarUrl: "https://pbs.twimg.com/profile_images/a.jpg",
		},
		metrics: { replies: 2, reposts: 3, likes: 26, views: 4504 },
		media: [
			{
				url: "https://pbs.twimg.com/media/a.jpg",
				type: "photo",
				localPath: "media/1-0.jpg",
			},
		],
	});
	return createThreadSnapshot({
		sourceUrl: rootTweet.url,
		scrapedAt: "2026-09-07T08:47:04.748Z",
		tweets: [rootTweet],
	});
}

describe("THREAD_COLUMNS", () => {
	it("matches the XCommentsExporter header exactly", () => {
		assert.deepEqual(THREAD_COLUMNS, expectedHeaders);
		assert.equal(THREAD_COLUMNS.length, 43);
	});
});

describe("tweetToRow", () => {
	it("maps snapshot fields to columns without inventing DOM-absent data", () => {
		const row = tweetToRow(
			sampleSnapshot().tweets[0],
			"2026-09-07T08:47:04.748Z",
		);
		const cell = (name) => row[THREAD_COLUMNS.indexOf(name)];

		assert.equal(cell("Tweet Id"), "1");
		assert.equal(cell("Tweet Url"), "https://x.com/a/status/1");
		assert.equal(cell("Media URLs"), "media/1-0.jpg");
		assert.equal(cell("Media Types"), "photo");
		assert.equal(cell("Media Count"), "1");
		assert.equal(cell("Conversation Id"), "1");
		assert.equal(cell("Reply Count"), "2");
		assert.equal(cell("Retweet Count"), "3");
		assert.equal(cell("Favorite Count"), "26");
		assert.equal(cell("View Count"), "4504");
		assert.equal(cell("Quote Count"), "");
		assert.equal(cell("Bookmark Count"), "");
		assert.equal(cell("User Screen Name"), "a");
		assert.equal(
			cell("User Avatar Url"),
			"https://pbs.twimg.com/profile_images/a.jpg",
		);
		assert.equal(cell("User Followers Count"), "");
		assert.equal(cell("Scraped At"), "2026-09-07T08:47:04.748Z");
	});

	it("derives entities honestly from the text itself", () => {
		const row = tweetToRow(
			sampleSnapshot().tweets[0],
			"2026-09-07T08:47:04.748Z",
		);
		const cell = (name) => row[THREAD_COLUMNS.indexOf(name)];

		assert.equal(cell("Hashtags"), "demo");
		assert.equal(cell("User Mentions"), "friend");
		assert.equal(cell("Expanded URLs"), "https://t.co/abc");
	});
});

describe("snapshotToCsv", () => {
	it("quotes commas, quotes, and newlines per RFC 4180", () => {
		const csv = snapshotToCsv(sampleSnapshot());
		const lines = csv.split("\r\n");

		assert.equal(lines.length, 2);
		assert.ok(lines[0].startsWith("Tweet Id,Full Text,"));
		assert.ok(lines[1].includes('"Hello, ""world""'));
	});

	it("keeps one row per tweet", () => {
		const snapshot = sampleSnapshot();
		snapshot.tweets.push(
			createTweet({ id: "2", text: "second", url: "https://x.com/a/status/2" }),
		);

		assert.equal(snapshotToRows(snapshot).length, 2);
	});
});
