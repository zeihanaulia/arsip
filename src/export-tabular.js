/**
 * Tabular exporters (Task 6): one row per tweet with the exact 43-column
 * layout of XCommentsExporter. Fields absent from the DOM stay empty and
 * are documented in docs/export-columns.md — never guessed.
 */

export const THREAD_COLUMNS = [
	"Tweet Id",
	"Full Text",
	"Tweet Url",
	"Media URLs",
	"Media Types",
	"Media Count",
	"Created At",
	"Conversation Id",
	"In Reply To Status Id",
	"In Reply To User Id",
	"In Reply To Screen Name",
	"Reply Count",
	"Retweet Count",
	"Favorite Count",
	"Quote Count",
	"Bookmark Count",
	"View Count",
	"Favorited",
	"Retweeted",
	"Bookmarked",
	"Is Quote Status",
	"Language",
	"Expanded URLs",
	"Hashtags",
	"User Mentions",
	"User Id",
	"User Name",
	"User Screen Name",
	"User Description",
	"User Followers Count",
	"User Friends Count",
	"User Favourites Count",
	"User Statuses Count",
	"User Listed Count",
	"User Avatar Url",
	"User Profile Banner Url",
	"User Location",
	"User Is Blue Verified",
	"User Is Verified",
	"User Is Protected",
	"User Professional Type",
	"User Created At",
	"Scraped At",
];

/**
 * @param {string} text
 * @param {RegExp} pattern Global regex with one capture group.
 * @returns {string} Space-separated matches, "" when none.
 */
function collectEntities(text, pattern) {
	const found = [];
	const source = String(text ?? "");
	pattern.lastIndex = 0;
	let match = pattern.exec(source);
	while (match) {
		found.push(match[1]);
		match = pattern.exec(source);
	}
	return found.join(" ");
}

/**
 * @param {import("./model.js").Tweet} tweet
 * @param {string} scrapedAt
 * @returns {string[]} One cell per THREAD_COLUMNS entry.
 */
export function tweetToRow(tweet, scrapedAt) {
	return [
		...identityCells(tweet),
		...mediaCells(tweet.media),
		...relationCells(tweet),
		...countCells(tweet.metrics),
		...flagCells(tweet),
		...entityCells(tweet.text),
		...userCells(tweet.user),
		scrapedAt ?? "", // Scraped At
	];
}

/**
 * @param {import("./model.js").Tweet} tweet
 * @returns {string[]} Tweet Id, Full Text, Tweet Url.
 */
function identityCells(tweet) {
	return [tweet.id ?? "", tweet.text ?? "", tweet.url ?? ""];
}

/**
 * @param {import("./model.js").TweetMedia[]} [media]
 * @returns {string[]} Media URLs, Media Types, Media Count.
 */
function mediaCells(media) {
	const items = media ?? [];
	const urls = items
		.map((item) => item.localPath || item.url)
		.filter((url) => url !== "");
	return [
		urls.join(" "),
		items.map((item) => item.type ?? "").join(" "),
		String(items.length),
	];
}

/**
 * @param {import("./model.js").Tweet} tweet
 * @returns {string[]} Created At, Conversation Id, In Reply To ×3.
 */
function relationCells(tweet) {
	return [
		tweet.createdAt ?? "",
		tweet.conversationId ?? "",
		tweet.replyTo ?? "",
		"", // In Reply To User Id (no DOM source)
		"", // In Reply To Screen Name (no DOM source)
	];
}
/**
 * @param {import("./model.js").TweetMetrics} [metrics]
 * @returns {string[]} Reply/Retweet/Favorite/Quote/Bookmark/View counts.
 */
function countCells(metrics) {
	const counts = /** @type {import("./model.js").TweetMetrics} */ (
		metrics ?? { replies: 0, reposts: 0, likes: 0, views: 0 }
	);
	return [
		String(counts.replies ?? 0),
		String(counts.reposts ?? 0),
		String(counts.likes ?? 0),
		countCell(counts.quotes),
		countCell(counts.bookmarks),
		String(counts.views ?? 0),
	];
}

/**
 * Viewer relations and flags: API-backed Yes/No, "" when unknown.
 *
 * @param {import("./model.js").Tweet} tweet
 * @returns {string[]} Favorited, Retweeted, Bookmarked, Is Quote, Language.
 */
function flagCells(tweet) {
	return [
		flagCell(tweet.favorited),
		flagCell(tweet.retweeted),
		flagCell(tweet.bookmarked),
		flagCell(tweet.isQuoteStatus),
		tweet.language ?? "",
	];
}

/**
 * @param {string} [text]
 * @returns {string[]} Expanded URLs, Hashtags, User Mentions.
 */
function entityCells(text) {
	const source = text ?? "";
	return [
		collectEntities(source, /(https?:\/\/[^\s]+)/g),
		collectEntities(source, /#(\w+)/g),
		collectEntities(source, /@(\w+)/g),
	];
}
/**
 * @param {import("./model.js").TweetUser} [user]
 * @returns {string[]} The 17 user columns in order.
 */
function userCells(user) {
	const profile = /** @type {import("./model.js").TweetUser} */ (
		user ?? { id: "", name: "", screenName: "", avatarUrl: "" }
	);
	return [
		profile.id ?? "",
		profile.name ?? "",
		profile.screenName ?? "",
		profile.description ?? "",
		countCell(profile.followersCount),
		countCell(profile.friendsCount),
		"", // User Favourites Count (no API/DOM source)
		countCell(profile.statusesCount),
		"", // User Listed Count (no API/DOM source)
		profile.avatarUrl ?? "",
		profile.bannerUrl ?? "",
		profile.location ?? "",
		flagCell(profile.blueVerified),
		flagCell(profile.verified),
		flagCell(profile.protected),
		profile.professionalType ?? "",
		profile.createdAt ?? "",
	];
}

/**
 * @param {number} [value]
 * @returns {string} "" when unknown — 0 would be a claim.
 */
function countCell(value) {
	return typeof value === "number" ? String(value) : "";
}

/**
 * @param {boolean} [value]
 * @returns {string} Yes/No when known, "" otherwise.
 */
function flagCell(value) {
	if (value === true) {
		return "Yes";
	}
	if (value === false) {
		return "No";
	}
	return "";
}

/**
 * @param {import("./model.js").ThreadSnapshot} snapshot
 * @returns {string[][]} Header plus one row per tweet.
 */
export function snapshotToRows(snapshot) {
	const tweets = snapshot?.tweets ?? [];
	const scrapedAt = snapshot?.scrapedAt ?? "";
	return [
		[...THREAD_COLUMNS],
		...tweets.map((tweet) => tweetToRow(tweet, scrapedAt)),
	];
}

/**
 * @param {string} cell
 * @returns {string} RFC 4180 quoting.
 */
function quoteCsv(cell) {
	const text = String(cell ?? "");
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * @param {import("./model.js").ThreadSnapshot} snapshot
 * @returns {string} CRLF-delimited CSV.
 */
export function snapshotToCsv(snapshot) {
	return snapshotToRows(snapshot)
		.map((row) => row.map(quoteCsv).join(","))
		.join("\r\n");
}
