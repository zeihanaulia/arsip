import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	renderMediaList,
	renderThreadHtml,
	renderThreadMarkdown,
} from "../src/export-html.js";
import { createThreadSnapshot, createTweet } from "../src/model.js";

function sampleSnapshot() {
	const root = createTweet({
		id: "1",
		text: "Paper on complexity <script>alert(1)</script>",
		url: "https://x.com/a/status/1",
		createdAt: "2026-09-05T18:26:02.000Z",
		conversationId: "1",
		user: { screenName: "asidorenko_", name: "Alex Sidorenko" },
		metrics: { likes: 26, reposts: 1, replies: 0, views: 4504 },
		media: [
			{
				url: "https://pbs.twimg.com/media/a.jpg",
				type: "photo",
				localPath: "media/1-0.jpg",
			},
		],
	});
	const reply = createTweet({
		id: "2",
		text: "@asidorenko_ demo video",
		url: "https://x.com/g/status/2",
		createdAt: "2026-09-05T20:56:02.000Z",
		conversationId: "1",
		inferred: true,
		user: { screenName: "gabimoncha", name: "Gabriel Moncha" },
		media: [
			{
				url: "https://pbs.twimg.com/amplify_video_thumb/p.jpg",
				type: "photo",
				localPath: "media/2-0.jpg",
			},
			{
				url: "blob:https://x.com/u",
				type: "video",
				localPath: "",
				unresolved: "fetch-failed",
			},
			{
				url: "https://video.twimg.com/c.en.vtt",
				type: "captions",
				localPath: "media/2-1.vtt",
				captionText: "Realistically speaking",
			},
		],
	});
	return createThreadSnapshot({
		sourceUrl: root.url,
		scrapedAt: "2026-09-07T08:47:04.748Z",
		tweets: [root, reply],
	});
}

describe("renderThreadHtml", () => {
	it("renders a standalone offline document with escaped text", () => {
		const html = renderThreadHtml(sampleSnapshot());

		assert.match(html, /^<!doctype html>/i);
		assert.ok(!html.includes("<script"), "no script tags allowed");
		assert.ok(!html.includes("<link"), "no external stylesheets allowed");
		assert.ok(html.includes("&lt;script&gt;"), "tweet text must be escaped");
		assert.ok(!html.includes('src="http'), "no remote dependencies allowed");
	});

	it("keeps thread order with local media and honest video notes", () => {
		const html = renderThreadHtml(sampleSnapshot());

		assert.ok(html.indexOf("asidorenko_") < html.indexOf("gabimoncha"));
		assert.ok(html.includes('src="media/1-0.jpg"'));
		assert.ok(html.includes('src="media/2-0.jpg"'));
		assert.ok(html.includes("fetch-failed"));
		assert.ok(html.includes("blob:https://x.com/u"));
		assert.ok(html.includes("Realistically speaking"));
		assert.ok(html.includes("26 likes"));
	});
});

describe("renderMediaList", () => {
	it("lists every media item with status and locations", () => {
		const md = renderMediaList(sampleSnapshot());

		assert.ok(md.includes("# Media (4 files, 1 unresolved)"));
		assert.ok(md.includes("media/1-0.jpg"));
		assert.ok(md.includes("https://pbs.twimg.com/media/a.jpg"));
		assert.ok(md.includes("fetch-failed"));
		assert.ok(md.includes("media/2-1.vtt"));
	});

	it("skips tweets without media", () => {
		const snapshot = sampleSnapshot();
		for (const tweet of snapshot.tweets) {
			tweet.media = [];
		}

		assert.equal(renderMediaList(snapshot), "# Media (0 files)\n");
	});
});

describe("renderThreadMarkdown", () => {
	it("reads as an ordered thread with authors, dates, and media", () => {
		const md = renderThreadMarkdown(sampleSnapshot());

		assert.ok(md.includes("https://x.com/a/status/1"));
		const head1 = md.indexOf("@asidorenko_");
		const head2 = md.indexOf("@gabimoncha");
		assert.ok(head1 >= 0 && head1 < head2);
		assert.ok(md.includes("![photo](media/1-0.jpg)"));
		assert.ok(md.includes("![photo](media/2-0.jpg)"));
		assert.ok(md.includes("fetch-failed"));
		assert.ok(md.includes("Realistically speaking"));
		assert.ok(md.includes("26 likes"));
		assert.ok(md.includes("2026-09-05"));
	});
});
