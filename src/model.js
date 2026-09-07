/**
 * Single data contract for the whole extension (Task 1).
 * Every exporter (HTML/MD/JSON/CSV/XLSX) consumes a ThreadSnapshot,
 * so DOM changes stay inside `x-adapter.js` and never leak here.
 */

/**
 * @typedef {Object} TweetUser
 * @property {string} id
 * @property {string} name
 * @property {string} screenName
 * @property {string} avatarUrl
 */

/**
 * @typedef {Object} TweetMedia
 * @property {string} url Original remote URL.
 * @property {"photo" | "video" | "gif" | "captions" | "unknown"} type
 * @property {string} [localPath] Path inside the exported ZIP, once downloaded.
 */

/**
 * @typedef {Object} TweetMetrics
 * @property {number} replies
 * @property {number} reposts
 * @property {number} likes
 * @property {number} views
 */

/**
 * @typedef {Object} Tweet
 * @property {string} id
 * @property {string} text
 * @property {string} url
 * @property {string} createdAt ISO timestamp, "" when the DOM hides it.
 * @property {TweetUser} user
 * @property {TweetMedia[]} media
 * @property {TweetMetrics} metrics Counts are 0 unless read from the DOM — never guessed.
 * @property {string | null} replyTo Parent tweet id, null for the thread root.
 * @property {string} conversationId
 * @property {boolean} inferred True when order/relation was derived from DOM order, not explicit data.
 */

/**
 * @typedef {Object} ThreadSnapshot
 * @property {string} sourceUrl Thread URL the user had open.
 * @property {string} scrapedAt ISO timestamp of the scrape.
 * @property {Tweet[]} tweets
 */

/**
 * Factory input: every field optional, nested objects accept partials.
 *
 * @typedef {Omit<Partial<Tweet>, "user" | "metrics"> & {
 *   user?: Partial<TweetUser>,
 *   metrics?: Partial<TweetMetrics>
 * }} TweetInput
 */

/**
 * @returns {TweetMetrics}
 */
function zeroMetrics() {
	return { replies: 0, reposts: 0, likes: 0, views: 0 };
}

/**
 * @param {TweetInput} [partial]
 * @returns {Tweet}
 */
export function createTweet(partial = {}) {
	const { id = "" } = partial;
	if (id.trim() === "") {
		throw new Error("createTweet requires a non-empty id");
	}
	const { user = {}, metrics = {}, media = [] } = partial;
	return {
		id,
		text: partial.text ?? "",
		url: partial.url ?? "",
		createdAt: partial.createdAt ?? "",
		replyTo: partial.replyTo ?? null,
		conversationId: partial.conversationId ?? "",
		inferred: partial.inferred ?? false,
		user: { id: "", name: "", screenName: "", avatarUrl: "", ...user },
		media: [...media],
		metrics: { ...zeroMetrics(), ...metrics },
	};
}

/**
 * @param {{ sourceUrl?: string, scrapedAt?: string, tweets?: Tweet[] }} [input]
 * @returns {ThreadSnapshot}
 */
export function createThreadSnapshot(input = {}) {
	const {
		sourceUrl = "",
		scrapedAt = new Date().toISOString(),
		tweets = [],
	} = input;
	if (sourceUrl.trim() === "") {
		throw new Error("createThreadSnapshot requires a non-empty sourceUrl");
	}
	return { sourceUrl, scrapedAt, tweets: [...tweets] };
}

/**
 * Collects every problem found so callers get the full picture at once.
 *
 * @param {ThreadSnapshot} snapshot
 * @returns {string[]} Empty when valid.
 */
export function validateSnapshot(snapshot) {
	const /** @type {string[]} */ errors = [];
	checkRoot(snapshot, errors);
	for (const [index, tweet] of (snapshot?.tweets ?? []).entries()) {
		checkTweet(tweet, index, errors);
	}
	return errors;
}

/**
 * @param {ThreadSnapshot} snapshot
 * @param {string[]} errors
 */
function checkRoot(snapshot, errors) {
	if (
		typeof snapshot?.sourceUrl !== "string" ||
		snapshot.sourceUrl.trim() === ""
	) {
		errors.push("sourceUrl must be a non-empty string");
	}
	if (Number.isNaN(Date.parse(snapshot?.scrapedAt))) {
		errors.push("scrapedAt must be a parseable date");
	}
	if (!Array.isArray(snapshot?.tweets)) {
		errors.push("tweets must be an array");
	}
}

/**
 * @param {Tweet} tweet
 * @param {number} index
 * @param {string[]} errors
 */
function checkTweet(tweet, index, errors) {
	const where = `tweets[${index}]`;
	if (typeof tweet?.id !== "string" || tweet.id.trim() === "") {
		errors.push(`${where}.id must be a non-empty string`);
	}
	if (typeof tweet?.text !== "string" || tweet.text.trim() === "") {
		errors.push(`${where}.text must be a non-empty string`);
	}
	if (typeof tweet?.url !== "string" || tweet.url.trim() === "") {
		errors.push(`${where}.url must be a non-empty string`);
	}
}

/**
 * Realistic two-tweet reply chain for exporter tests and manual probes.
 *
 * @returns {ThreadSnapshot}
 */
export function exampleSnapshot() {
	const root = createTweet({
		id: "2096302171243315378",
		text: "Paper on cognitive complexity",
		url: "https://x.com/asidorenko_/status/2096302171243315378",
		createdAt: "2026-09-05T18:26:02.000Z",
		conversationId: "2096302171243315378",
		user: {
			id: "4885926545",
			name: "Alex Sidorenko",
			screenName: "asidorenko_",
		},
	});
	const reply = createTweet({
		id: "2096341610078384152",
		text: "@asidorenko_ isn't this cyclomatic complexity?",
		url: "https://x.com/gabimoncha/status/2096341610078384152",
		createdAt: "2026-09-05T20:56:02.000Z",
		replyTo: root.id,
		conversationId: root.conversationId,
		user: {
			id: "1060511592146710528",
			name: "Gabriel Moncha",
			screenName: "gabimoncha",
		},
	});
	return createThreadSnapshot({
		sourceUrl: root.url,
		scrapedAt: "2026-09-07T08:47:04.748Z",
		tweets: [root, reply],
	});
}
