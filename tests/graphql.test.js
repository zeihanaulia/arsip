import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createThreadSnapshot, createTweet } from "../src/model.js";
import { assembleSnapshot } from "../src/snapshot.js";
import { extractRawTweets, mergeApiIntoSnapshot } from "../src/x-graphql.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const payload = JSON.parse(
	readFileSync(join(root, "tests/fixtures/x-tweet-detail.json"), "utf8"),
);

describe("extractRawTweets", () => {
	it("reads root plus thread items from a real TweetDetail payload", () => {
		const tweets = extractRawTweets(payload);

		assert.equal(tweets.length, 2);
		assert.equal(tweets[0].id, "2096854674938941448");
		assert.ok(tweets[0].text.startsWith("If you understand"));
		assert.equal(
			tweets[0].url,
			"https://x.com/theo/status/2096854674938941448",
		);
		assert.equal(tweets[1].id, "2097417692647186780");
	});

	it("takes counts, users, and reply refs from the API, not the DOM", () => {
		const tweets = extractRawTweets(payload);
		const root = tweets[0];

		assert.equal(root.metrics.likes, 3580);
		assert.equal(root.metrics.reposts, 178);
		assert.equal(root.metrics.replies, 529);
		assert.equal(root.metrics.views, 2580704);
		assert.equal(root.user.screenName, "theo");
		assert.equal(root.user.name, "Theo - t3.gg");
		assert.equal(root.conversationId, "2096854674938941448");
		assert.equal(tweets[1].replyTo, "2096854674938941448");
	});

	it("keeps the poster and the best mp4 variant for videos", () => {
		const tweets = extractRawTweets(payload);
		const urls = tweets[0].media.map((item) => item.url);

		assert.ok(
			urls.some((url) => url.includes("amplify_video_thumb")),
			"poster kept",
		);
		const mp4 = tweets[0].media.find((item) => item.type === "video");
		assert.ok(mp4, "mp4 variant kept");
		assert.ok(mp4.url.includes("video.twimg.com"));
		assert.ok(!mp4.url.includes(".m3u8"), "never an HLS playlist");
	});

	it("ignores non-tweet results instead of guessing", () => {
		const tweets = extractRawTweets({ data: {} });

		assert.deepEqual(tweets, []);
	});
});

describe("mergeApiIntoSnapshot", () => {
	function domSnapshot() {
		return assembleSnapshot(
			[
				{
					id: "2096854674938941448",
					text: "If you understand",
					url: "https://x.com/theo/status/2096854674938941448",
					user: { screenName: "theo" },
				},
			],
			"https://x.com/theo/status/2096854674938941448",
		);
	}

	it("fills DOM gaps with API truth and keeps DOM-only tweets", () => {
		const snapshot = domSnapshot();
		snapshot.tweets.push(
			createTweet({
				id: "999",
				text: "dom only",
				url: "https://x.com/a/status/999",
			}),
		);

		const merged = mergeApiIntoSnapshot(snapshot, extractRawTweets(payload));

		assert.equal(merged.tweets.length, 2);
		const root = merged.tweets[0];
		assert.equal(root.metrics.likes, 3580);
		assert.equal(root.user.name, "Theo - t3.gg");
		assert.ok(root.media.some((item) => item.type === "video"));
		assert.equal(merged.tweets[1].id, "999");
	});

	it("leaves the snapshot untouched when the API has nothing new", () => {
		const snapshot = createThreadSnapshot({
			sourceUrl: "https://x.com/a/status/1",
		});

		assert.deepEqual(mergeApiIntoSnapshot(snapshot, []).tweets, []);
	});
});
