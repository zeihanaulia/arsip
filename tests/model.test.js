import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	createThreadSnapshot,
	createTweet,
	exampleSnapshot,
	validateSnapshot,
} from "../src/model.js";

describe("createTweet", () => {
	it("fills defaults for fields the DOM did not provide", () => {
		const tweet = createTweet({ id: "123" });

		assert.equal(tweet.id, "123");
		assert.equal(tweet.text, "");
		assert.deepEqual(tweet.media, []);
		assert.deepEqual(tweet.metrics, {
			replies: 0,
			reposts: 0,
			likes: 0,
			views: 0,
		});
		assert.equal(tweet.replyTo, null);
		assert.equal(tweet.inferred, false);
	});

	it("keeps caller-provided values instead of defaults", () => {
		const tweet = createTweet({
			id: "123",
			text: "hello",
			user: { screenName: "someone" },
			metrics: { likes: 5 },
		});

		assert.equal(tweet.text, "hello");
		assert.equal(tweet.user.screenName, "someone");
		assert.equal(tweet.metrics.likes, 5);
		assert.equal(tweet.metrics.replies, 0);
	});

	it("throws when id is missing so bad data fails loudly", () => {
		assert.throws(() => createTweet({}), /id/);
		assert.throws(() => createTweet({ id: "" }), /id/);
	});
});

describe("createThreadSnapshot", () => {
	it("defaults scrapedAt to now in ISO format", () => {
		const before = new Date();
		const snapshot = createThreadSnapshot({
			sourceUrl: "https://x.com/a/status/1",
		});

		assert.ok(snapshot.scrapedAt >= before.toISOString());
		assert.deepEqual(snapshot.tweets, []);
	});

	it("throws when sourceUrl is missing", () => {
		assert.throws(() => createThreadSnapshot({ sourceUrl: "" }), /sourceUrl/);
	});
});

describe("validateSnapshot", () => {
	it("accepts the example fixture with no errors", () => {
		assert.deepEqual(validateSnapshot(exampleSnapshot()), []);
	});

	it("links the example reply to its parent", () => {
		const snapshot = exampleSnapshot();

		assert.equal(snapshot.tweets.length, 2);
		assert.equal(snapshot.tweets[1].replyTo, snapshot.tweets[0].id);
		assert.equal(
			snapshot.tweets[1].conversationId,
			snapshot.tweets[0].conversationId,
		);
	});

	it("reports each problem instead of stopping at the first", () => {
		const snapshot = createThreadSnapshot({
			sourceUrl: "https://x.com/a/status/1",
		});
		snapshot.scrapedAt = "not-a-date";
		snapshot.tweets = [createTweet({ id: "1" })];
		snapshot.tweets[0].text = "";

		const errors = validateSnapshot(snapshot);

		assert.ok(errors.length >= 2, `expected several errors, got: ${errors}`);
	});

	it("rejects tweets with blank ids", () => {
		const snapshot = createThreadSnapshot({
			sourceUrl: "https://x.com/a/status/1",
		});
		snapshot.tweets = [createTweet({ id: "1" })];
		snapshot.tweets[0].id = "";

		assert.ok(validateSnapshot(snapshot).length > 0);
	});
});
