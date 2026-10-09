/**
 * The only file allowed to query the X DOM (Task 2).
 * Classic script on purpose (see content.js): exposes `XAdapter` on
 * globalThis so content scripts can use it without imports.
 * Photos are parsed now; video/GIF variants land in Task 4.
 */

/**
 * @typedef {Object} RawTweet Unvalidated adapter output; snapshot.js turns it into a Tweet.
 * @property {string} id
 * @property {string} [text]
 * @property {string} [url]
 * @property {string} [createdAt]
 * @property {{ id?: string, name?: string, screenName?: string, avatarUrl?: string }} [user]
 * @property {{ url: string, type: string }[]} [media]
 * @property {{ replies?: number, reposts?: number, likes?: number, views?: number }} [metrics]
 * @property {boolean} [promoted]
 * @property {boolean} [isArticle]
 * @property {{ title: string, text: string, coverUrl?: string }} [article]
 */

const SELECTORS = {
	article: ['article[data-testid="tweet"]', 'article[role="article"]'],
	text: ['[data-testid="tweetText"]'],
	userName: ['[data-testid="User-Name"]'],
	time: ["time"],
	statusLink: ['a[href*="/status/"]'],
	labeled: ["[aria-label]"],
	articleReader: ['[data-testid="twitterArticleReadView"]'],
	articleTitle: [
		'[data-testid="twitter-article-title"]',
		'[data-testid="articleTitle"]',
		'h1[dir="ltr"]',
		"h1",
	],
	articleRichText: ['[data-testid="twitterArticleRichTextView"]'],
};

/**
 * DraftJS blocks X renders inside an article reader. Class-name matches
 * are deliberately loose (`longform-header-*`) because the tag X uses
 * has changed between releases.
 */
const ARTICLE_BLOCK_SELECTOR = [
	"div.longform-unstyled",
	"blockquote.longform-blockquote",
	"[class*='longform-header-one']",
	"[class*='longform-header-two']",
	"[class*='longform-header-three']",
	"[class*='longform-unordered-list']",
	"[class*='longform-ordered-list']",
].join(",");
/**
 * @param {ParentNode} root
 * @param {string[]} selectors Fallbacks, first hit wins.
 * @returns {Element | null}
 */
function queryFirst(root, selectors) {
	for (const selector of selectors) {
		const found = root.querySelector(selector);
		if (found) {
			return found;
		}
	}
	return null;
}

/**
 * @param {ParentNode} [root]
 * @returns {Element[]}
 */
function findTweetElements(root) {
	const doc = root ?? document;
	const seen = new Set();
	const elements = [];
	for (const selector of SELECTORS.article) {
		for (const el of doc.querySelectorAll(selector)) {
			if (!seen.has(el)) {
				seen.add(el);
				elements.push(el);
			}
		}
	}
	return elements;
}

/**
 * @param {string} text e.g. "1.2K", "4,504", "26"
 * @returns {number} 0 when unparseable — never guessed.
 */
function parseCount(text) {
	const match = /^\s*([\d.,]+)\s*([KMB])?\s*$/i.exec(text ?? "");
	if (!match) {
		return 0;
	}
	const /** @type {Record<string, number>} */ multipliers = {
			K: 1e3,
			M: 1e6,
			B: 1e9,
		};
	const value = Number.parseFloat(match[1].replace(/,/g, ""));
	if (Number.isNaN(value)) {
		return 0;
	}
	return Math.round(value * (multipliers[match[2]?.toUpperCase()] ?? 1));
}

/**
 * @param {Element} article
 * @returns {{ id: string, url: string } | null} Null when unidentifiable.
 */
function identify(article) {
	const link = queryFirst(article, SELECTORS.statusLink);
	const href = link?.getAttribute("href") ?? "";
	const match = /\/status\/(\d+)/.exec(href);
	if (!match) {
		return null;
	}
	const url = href.startsWith("http") ? href : `https://x.com${href}`;
	return { id: match[1], url };
}

/**
 * Promoted tweets carry an analytics URL, a small Ad/Promoted badge, or
 * both. The badge check stays clear of the tweet text (exact match on
 * short spans only) so a tweet merely saying "ad" is never flagged.
 *
 * @param {Element} article
 * @param {string} href Status link href ("" when absent).
 * @returns {boolean}
 */
function isPromoted(article, href) {
	if (href.includes("/analytics")) {
		return true;
	}
	const text = queryFirst(article, SELECTORS.text);
	for (const el of article.querySelectorAll("span,div")) {
		if (text?.contains(el)) {
			continue;
		}
		const label = (el.textContent ?? "").trim();
		if (
			label !== "" &&
			label.length < 20 &&
			/^(ad|promoted|iklan)$/i.test(label) &&
			el.children.length === 0
		) {
			return true;
		}
	}
	return false;
}

/**
 * @param {ParentNode} article
 * @returns {{ name: string, screenName: string, avatarUrl: string }}
 */
function parseUser(article) {
	const block = queryFirst(article, SELECTORS.userName);
	const spans = [...(block?.querySelectorAll("span") ?? [])].map((s) =>
		(s.textContent ?? "").trim(),
	);
	const mention = spans.find((s) => s.startsWith("@"));
	const avatar = article.querySelector('img[src*="profile_images"]');
	return {
		name: spans.find((s) => s !== "" && s !== mention) ?? "",
		screenName: mention?.slice(1) ?? "",
		avatarUrl: avatar?.getAttribute("src") ?? "",
	};
}

/**
 * @param {ParentNode} article
 * @returns {{ replies: number, reposts: number, likes: number, views: number }}
 */
function parseMetrics(article) {
	const metrics = { replies: 0, reposts: 0, likes: 0, views: 0 };
	for (const el of article.querySelectorAll(SELECTORS.labeled.join(","))) {
		const label = el.getAttribute("aria-label") ?? "";
		for (const key of /** @type {(keyof metrics)[]} */ (Object.keys(metrics))) {
			const match = new RegExp(`([\\d.,KMB]+)\\s+${key}`, "i").exec(label);
			if (match) {
				metrics[key] = parseCount(match[1]);
			}
		}
	}
	return metrics;
}

/**
 * @param {Element} article
 * @returns {RawTweet | null} Null when the tweet cannot be identified.
 */
function parseTweet(article) {
	const id = identify(article);
	if (!id) {
		return null;
	}
	const time =
		queryFirst(article, SELECTORS.time)?.getAttribute("datetime") ?? "";
	const parsed = Date.parse(time);
	return {
		id: id.id,
		url: id.url,
		text: (queryFirst(article, SELECTORS.text)?.textContent ?? "").trim(),
		createdAt: Number.isNaN(parsed) ? "" : new Date(parsed).toISOString(),
		user: parseUser(article),
		media: collectMedia(article),
		metrics: parseMetrics(article),
		promoted: isPromoted(article, id.url),
	};
}

/**
 * Photos, video posters, and video sources. Inventory only — no fetching.
 * Blob/HLS sources stay listed so the media layer can mark them unresolved
 * instead of silently dropping them.
 *
 * @param {Element} article
 * @returns {{ url: string, type: string }[]}
 */
function collectMedia(article) {
	const seen = new Set();
	const /** @type {{ url: string, type: string }[]} */ media = [];
	for (const img of article.querySelectorAll(
		'img[src*="pbs.twimg.com/media"]',
	)) {
		addMedia(media, seen, img.getAttribute("src") ?? "", "photo");
	}
	for (const video of article.querySelectorAll("video")) {
		addMedia(media, seen, video.getAttribute("poster") ?? "", "photo");
		addMedia(media, seen, video.getAttribute("src") ?? "", "video");
		for (const source of video.querySelectorAll("source")) {
			addMedia(media, seen, source.getAttribute("src") ?? "", "video");
		}
		for (const track of video.querySelectorAll("track")) {
			addMedia(media, seen, track.getAttribute("src") ?? "", "captions");
		}
	}
	return media;
}

/**
 * @param {{ url: string, type: string }[]} media
 * @param {Set<string>} seen
 * @param {string} url
 * @param {string} type
 */
function addMedia(media, seen, url, type) {
	if (url !== "" && !seen.has(url)) {
		seen.add(url);
		media.push({ url, type });
	}
}

/**
 * Status id from a thread page URL: `/status/<id>` first (the canonical
 * post id), then `/article/<id>` (reader view). "" when neither.
 *
 * @param {string} pageUrl
 * @returns {string}
 */
function articleIdFromUrl(pageUrl) {
	return (
		/\/status\/(\d+)/.exec(pageUrl ?? "")?.[1] ??
		/\/article\/(\d+)/.exec(pageUrl ?? "")?.[1] ??
		""
	);
}

/**
 * @param {Element} reader
 * @returns {string}
 */
function articleTitleDom(reader) {
	return (queryFirst(reader, SELECTORS.articleTitle)?.textContent ?? "").trim();
}

/**
 * One DraftJS block to one Markdown line. Unknown block types stay
 * plain so formatting is never invented.
 *
 * @param {Element} block
 * @returns {string}
 */
function articleBlockMarkdown(block) {
	const text = (block.textContent ?? "").trim();
	if (text === "") {
		return "";
	}
	const className = block.getAttribute("class") ?? "";
	if (className.includes("header-one") || block.tagName === "H1") {
		return `# ${text}`;
	}
	if (className.includes("header-two")) {
		return `## ${text}`;
	}
	if (className.includes("header-three")) {
		return `### ${text}`;
	}
	if (block.tagName === "BLOCKQUOTE" || className.includes("blockquote")) {
		return text
			.split("\n")
			.map((line) => `> ${line}`)
			.join("\n");
	}
	if (className.includes("unordered-list")) {
		return `- ${text}`;
	}
	if (className.includes("ordered-list")) {
		return `1. ${text}`;
	}
	return text;
}

/**
 * Article body from the rendered reader. Prefers the DraftJS blocks so
 * headings/quotes survive; falls back to the rich-text node's text.
 * A leading block that merely repeats the title is dropped.
 *
 * @param {Element} reader
 * @returns {string}
 */
function articleBodyDom(reader) {
	const rich = queryFirst(reader, SELECTORS.articleRichText) ?? reader;
	const blocks = [...rich.querySelectorAll(ARTICLE_BLOCK_SELECTOR)];
	if (blocks.length === 0) {
		return (rich.textContent ?? "").trim();
	}
	const title = articleTitleDom(reader);
	const lines = [];
	for (const [index, block] of blocks.entries()) {
		const line = articleBlockMarkdown(block);
		if (line === "") {
			continue;
		}
		if (index === 0 && line.replace(/^#\s*/, "") === title) {
			continue;
		}
		lines.push(line);
	}
	return lines.join("\n\n");
}

/**
 * The X Article reader, when the open page renders one. Returns null on
 * any page without a reader so thread scraping stays untouched.
 *
 * @param {ParentNode} doc
 * @param {string} pageUrl
 * @returns {RawTweet | null}
 */
function parseArticleDom(doc, pageUrl) {
	const reader = queryFirst(doc, SELECTORS.articleReader);
	if (!reader) {
		return null;
	}
	const id = articleIdFromUrl(pageUrl);
	if (id === "") {
		return null;
	}
	const title = articleTitleDom(reader);
	const body = articleBodyDom(reader);
	const user = parseUser(doc);
	const url = user.screenName
		? `https://x.com/${user.screenName}/status/${id}`
		: (pageUrl ?? "").split(/[?#]/)[0];
	return {
		id,
		url,
		text: title === "" ? body : `# ${title}\n\n${body}`,
		user,
		media: collectMedia(reader),
		metrics: parseMetrics(reader),
		promoted: false,
		isArticle: true,
		article: { title, text: body },
	};
}

/**
 * Fills missing user fields from `extra`, keeping `base` otherwise.
 *
 * @param {{ id?: string, name?: string, screenName?: string, avatarUrl?: string } | undefined} base
 * @param {{ id?: string, name?: string, screenName?: string, avatarUrl?: string } | undefined} extra
 * @returns {{ id: string, name: string, screenName: string, avatarUrl: string }}
 */
function mergeUserFields(base, extra) {
	const merged = {
		id: "",
		name: "",
		screenName: "",
		avatarUrl: "",
		...(base ?? {}),
	};
	/** @type {("id" | "name" | "screenName" | "avatarUrl")[]} */
	const keys = ["id", "name", "screenName", "avatarUrl"];
	for (const key of keys) {
		const value = extra?.[key];
		if (typeof value === "string" && value !== "") {
			merged[key] = value;
		}
	}
	return merged;
}

/**
 * @param {{ url: string, type: string }[] | undefined} base
 * @param {{ url: string, type: string }[] | undefined} extra
 * @returns {{ url: string, type: string }[]}
 */
function unionMedia(base, extra) {
	const seen = new Set();
	const media = [];
	for (const item of [...(base ?? []), ...(extra ?? [])]) {
		if (item?.url && !seen.has(item.url)) {
			seen.add(item.url);
			media.push(item);
		}
	}
	return media;
}

/**
 * Counts on a re-render can be missing; the higher sighting wins so a
 * duplicate cell never erases metrics the first one carried.
 *
 * @param {{ replies?: number, reposts?: number, likes?: number, views?: number } | undefined} base
 * @param {{ replies?: number, reposts?: number, likes?: number, views?: number } | undefined} extra
 * @returns {{ replies: number, reposts: number, likes: number, views: number }}
 */
function mergeMetrics(base, extra) {
	const merged = {
		replies: 0,
		reposts: 0,
		likes: 0,
		views: 0,
		...(base ?? {}),
	};
	/** @type {("replies" | "reposts" | "likes" | "views")[]} */
	const keys = ["replies", "reposts", "likes", "views"];
	for (const key of keys) {
		const value = extra?.[key];
		if (typeof value === "number" && value > merged[key]) {
			merged[key] = value;
		}
	}
	return merged;
}

/**
 * Two sightings of one tweet (e.g. the article reader and its tweet
 * cell): longest text wins, richer user/media/metrics fill the gaps.
 *
 * @param {RawTweet} base
 * @param {RawTweet} extra
 * @returns {RawTweet}
 */
function mergeRawTweets(base, extra) {
	const baseText = typeof base.text === "string" ? base.text : "";
	const extraText = typeof extra.text === "string" ? extra.text : "";
	return {
		...base,
		...extra,
		text: extraText.length > baseText.length ? extraText : baseText,
		user: mergeUserFields(base.user, extra.user),
		media: unionMedia(base.media, extra.media),
		metrics: mergeMetrics(base.metrics, extra.metrics),
		promoted: base.promoted === true || extra.promoted === true,
		isArticle: base.isArticle === true || extra.isArticle === true,
		article: base.article ?? extra.article,
	};
}

/**
 * Text-only expanders: truncated tweet bodies use a non-button "Show
 * more" (div/span inside the article). Three hard rules so a click can
 * NEVER navigate the tab away (clicking a link mid-scrape aborts the
 * scrape on the wrong page and orphans Cancel):
 * - exact text "show more" only (ads and "Show more replies" untouched),
 * - never a link (a[href] would navigate),
 * - must sit inside a tweet article (sidebar/footer lookalikes untouched).
 * Clicking these never loads new tweets — safe for viewport-only mode.
 *
 * @param {ParentNode} [root]
 * @returns {HTMLElement[]}
 */
function findTextExpanders(root) {
	const doc = root ?? document;
	const expanders = [];
	for (const el of doc.querySelectorAll("div, span")) {
		if (!(el instanceof HTMLElement) || el.closest("button")) {
			continue;
		}
		if ((el.textContent ?? "").trim().toLowerCase() !== "show more") {
			continue;
		}
		if (!el.closest('article[data-testid="tweet"]')) {
			continue;
		}
		expanders.push(el);
	}
	return expanders;
}

/**
 * Buttons that reveal more of the thread. Text matching is a fallback:
 * X restyles often, but the affordance wording is comparatively stable.
 *
 * @param {ParentNode} [root]
 * @returns {HTMLElement[]}
 */
function findExpandButtons(root) {
	const doc = root ?? document;
	const buttons = [];
	for (const button of doc.querySelectorAll("button")) {
		const label = (button.textContent ?? "").trim().toLowerCase();
		if (
			label !== "" &&
			(label.includes("show more") || label.includes("show this thread"))
		) {
			buttons.push(button);
		}
	}
	buttons.push(...findTextExpanders(doc));
	return buttons;
}

/**
 * @param {string} pageUrl
 * @returns {string} The status id, or "" when the URL is not a thread.
 */
function conversationIdFromUrl(pageUrl) {
	return /\/status\/(\d+)/.exec(pageUrl ?? "")?.[1] ?? "";
}

/**
 * Scrape every loaded tweet in DOM order, deduped by id. The X Article
 * reader (when present) is folded in first so the article root leads
 * the thread instead of being skipped for lack of a `/status/` link.
 *
 * @param {ParentNode} [doc]
 * @param {string} [pageUrl]
 * @returns {{ tweets: RawTweet[], url: string }}
 */
function scrapeRaw(doc, pageUrl = "") {
	const byId = new Map();
	/** @type {string[]} */
	const order = [];
	/**
	 * @param {RawTweet | null} tweet
	 */
	const put = (tweet) => {
		if (!tweet || typeof tweet.id !== "string" || tweet.id === "") {
			return;
		}
		const existing = byId.get(tweet.id);
		if (existing) {
			byId.set(tweet.id, mergeRawTweets(existing, tweet));
			return;
		}
		byId.set(tweet.id, tweet);
		order.push(tweet.id);
	};
	put(parseArticleDom(doc ?? document, pageUrl));
	for (const article of findTweetElements(doc)) {
		put(parseTweet(article));
	}
	const tweets = [];
	for (const id of order) {
		const tweet = byId.get(id);
		if (tweet) {
			tweets.push(tweet);
		}
	}
	return { tweets, url: pageUrl };
}

globalThis.XAdapter = {
	conversationIdFromUrl,
	findExpandButtons,
	findTextExpanders,
	findTweetElements,
	parseArticleDom,
	parseCount,
	parseTweet,
	scrapeRaw,
};
