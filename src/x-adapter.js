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
 */

const SELECTORS = {
	article: ['article[data-testid="tweet"]', 'article[role="article"]'],
	text: ['[data-testid="tweetText"]'],
	userName: ['[data-testid="User-Name"]'],
	time: ["time"],
	statusLink: ['a[href*="/status/"]'],
	labeled: ["[aria-label]"],
};
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
 * @param {Element} article
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
 * @param {Element} article
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
 * Buttons that reveal more of the thread. Text matching is a fallback:
 * X restyles often, but the affordance wording is comparatively stable.
 *
 * @param {ParentNode} [root]
 * @returns {HTMLButtonElement[]}
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
 * Scrape every loaded tweet in DOM order, deduped by id.
 *
 * @param {ParentNode} [doc]
 * @param {string} [pageUrl]
 * @returns {{ tweets: RawTweet[], url: string }}
 */
function scrapeRaw(doc, pageUrl = "") {
	const tweets = [];
	const seen = new Set();
	for (const article of findTweetElements(doc)) {
		const tweet = parseTweet(article);
		if (!tweet || seen.has(tweet.id)) {
			continue;
		}
		seen.add(tweet.id);
		tweets.push(tweet);
	}
	return { tweets, url: pageUrl };
}

globalThis.XAdapter = {
	conversationIdFromUrl,
	findExpandButtons,
	findTweetElements,
	parseCount,
	parseTweet,
	scrapeRaw,
};
