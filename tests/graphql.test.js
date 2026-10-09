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
const articlePayload = JSON.parse(
	readFileSync(join(root, "tests/fixtures/x-article-detail.json"), "utf8"),
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
		assert.equal(root.metrics.quotes, 410);
		assert.equal(root.metrics.bookmarks, 2036);
		assert.equal(root.language, "en");
		assert.equal(root.user.screenName, "theo");
		assert.equal(root.user.name, "Theo - t3.gg");
		assert.equal(root.conversationId, "2096854674938941448");
		assert.equal(tweets[1].replyTo, "2096854674938941448");
	});

	it("reads extended user fields the DOM never provides", () => {
		const user = extractRawTweets(payload)[0].user;

		assert.equal(user.followersCount, 387449);
		assert.equal(user.friendsCount, 4228);
		assert.equal(user.statusesCount, 66559);
		assert.equal(user.location, "San Francisco, CA");
		assert.equal(user.blueVerified, true);
		assert.equal(user.verified, false);
		assert.equal(user.protected, false);
		assert.equal(user.professionalType, "Creator");
		assert.ok((user.bannerUrl ?? "").includes("profile_banners"), "banner url");
		assert.ok(
			(user.description ?? "").includes("Full time CEO"),
			"description",
		);
		assert.ok((user.createdAt ?? "").includes("2016"), "user created year");
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

	it("prefers the smallest mp4 variant for fetchability", () => {
		const tweets = extractRawTweets(payload);
		const mp4 = tweets[0].media.find((item) => item.type === "video");

		assert.ok(mp4?.url.includes("/480x270/"), "lowest bitrate wins");
	});

	it("ignores non-tweet results instead of guessing", () => {
		const tweets = extractRawTweets({ data: {} });

		assert.deepEqual(tweets, []);
	});

	it("prefers note_tweet full text over truncated legacy text", () => {
		const notePayload = JSON.parse(
			readFileSync(
				join(root, "tests/fixtures/x-tweet-detail-note.json"),
				"utf8",
			),
		);
		const tweets = extractRawTweets(notePayload);
		const noteRoot = tweets.find((t) => t.id === "2098232985938194881");

		assert.ok(noteRoot, "root tweet extracted");
		assert.ok(
			(noteRoot?.text ?? "").includes("Number one tip: act with agency."),
			"full note text, not the 279-char legacy truncation",
		);
		assert.ok((noteRoot?.text ?? "").length > 1000);
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

		assert.equal(merged.tweets.length, 3);
		const root = merged.tweets[0];
		assert.equal(root.metrics.likes, 3580);
		assert.equal(root.user.name, "Theo - t3.gg");
		assert.ok(root.media.some((item) => item.type === "video"));
		assert.equal(merged.tweets[1].id, "999");
		assert.equal(merged.tweets[2].id, "2097417692647186780");
	});

	it("leaves the snapshot untouched when the API has nothing new", () => {
		const snapshot = createThreadSnapshot({
			sourceUrl: "https://x.com/a/status/1",
		});

		assert.deepEqual(mergeApiIntoSnapshot(snapshot, []).tweets, []);
	});

	it("appends API-only tweets instead of dropping them", () => {
		const snapshot = assembleSnapshot(
			[
				{
					id: "2096854674938941448",
					text: "root",
					url: "https://x.com/theo/status/2096854674938941448",
				},
			],
			"https://x.com/theo/status/2096854674938941448",
		);

		const merged = mergeApiIntoSnapshot(snapshot, extractRawTweets(payload));

		const reply = merged.tweets.find((t) => t.id === "2097417692647186780");
		assert.ok(reply, "API-only reply appended");
		assert.equal(reply.replyTo, "2096854674938941448");
		assert.equal(reply.inferred, false);
		assert.equal(reply.metrics.likes, 79);
	});

	it("dedups the same API tweet across bodies", () => {
		const snapshot = assembleSnapshot(
			[
				{
					id: "2096854674938941448",
					text: "root",
					url: "https://x.com/theo/status/2096854674938941448",
				},
			],
			"https://x.com/theo/status/2096854674938941448",
		);
		const api = extractRawTweets(payload);

		const merged = mergeApiIntoSnapshot(snapshot, [...api, ...api]);

		const ids = merged.tweets.map((t) => t.id);
		assert.equal(ids.length, new Set(ids).size);
	});
});

describe("extractRawTweets — X Article", () => {
	function articleRoot() {
		const article = extractRawTweets(articlePayload).find(
			(tweet) => tweet.isArticle,
		);
		assert.ok(article, "article root extracted");
		return article;
	}

	it("reads title and cover from article.article_results.result", () => {
		const article = articleRoot();

		assert.ok(article.article, "article metadata present");
		assert.equal(article.id, "2108213283144810958");
		assert.equal(article.article.title, "The Infinite SaaS Factory");
		assert.equal(
			article.article.coverUrl,
			"https://pbs.twimg.com/media/ARTICLE_COVER.jpg",
		);
	});

	it("renders headings, lists, quotes, links and media to body text", () => {
		const article = articleRoot();
		assert.ok(article.article, "article metadata present");
		const body = article.article.text;

		assert.ok(
			body.startsWith("The opportunity is to reinvent"),
			"leading title block dropped, body leads",
		);
		assert.ok(body.includes("## Why it matters"), "h2 kept");
		assert.ok(body.includes("- Agents need a substrate"), "list item kept");
		assert.ok(
			body.includes("> Software eats the world; agents eat software."),
			"blockquote kept",
		);
		assert.ok(
			body.includes("[here](https://example.com/infinite)"),
			"link entity rendered",
		);
		assert.ok(
			body.includes("![image](https://pbs.twimg.com/media/ARTICLE_BODY.jpg)"),
			"atomic media rendered in place",
		);
	});

	it("puts the full article on tweet.text with the title exactly once", () => {
		const article = articleRoot();

		assert.ok(article.text.startsWith("# The Infinite SaaS Factory\n\n"));
		assert.equal(
			article.text.match(/# The Infinite SaaS Factory/g)?.length,
			1,
			"title repeated",
		);
	});

	it("collects article media so it can be downloaded locally", () => {
		const urls = articleRoot().media.map((item) => item.url);

		assert.ok(urls.includes("https://pbs.twimg.com/media/ARTICLE_COVER.jpg"));
		assert.ok(urls.includes("https://pbs.twimg.com/media/ARTICLE_BODY.jpg"));
	});

	it("does not mark a plain reply as an article", () => {
		const reply = extractRawTweets(articlePayload).find(
			(tweet) => tweet.id === "2108317616569831556",
		);
		assert.ok(reply, "reply extracted");

		assert.equal(reply.isArticle, false);
		assert.equal(reply.article, undefined);
		assert.equal(reply.replyTo, "2108213283144810958");
	});
});

describe("mergeApiIntoSnapshot — X Article", () => {
	it("appends the article root the DOM never captured", () => {
		const snapshot = assembleSnapshot(
			[
				{
					id: "2108317616569831556",
					text: "reply only",
					url: "https://x.com/Aaronontheweb/status/2108317616569831556",
				},
			],
			"https://x.com/satyanadella/status/2108213283144810958",
		);

		const merged = mergeApiIntoSnapshot(
			snapshot,
			extractRawTweets(articlePayload),
		);

		const rootTweet = merged.tweets.find(
			(tweet) => tweet.id === "2108213283144810958",
		);
		assert.ok(rootTweet, "article root appended");
		assert.equal(rootTweet.isArticle, true);
		assert.ok(rootTweet.article, "article metadata present");
		assert.ok(rootTweet.article.text.includes("## Why it matters"));
		assert.ok(rootTweet.text.startsWith("# The Infinite SaaS Factory"));
	});
});
