/**
 * X API response parser (Task 7). The ONLY file allowed to read API
 * payload shapes. Fields absent from the payload stay empty — never
 * guessed from URL patterns. Works on captured responses (TweetDetail,
 * TweetResultByRestId); DOM scraping stays in x-adapter.js.
 */
import { createTweet } from "./model.js";

/**
 * @typedef {Object} ApiUser
 * @property {string} id
 * @property {string} name
 * @property {string} screenName
 * @property {string} avatarUrl
 * @property {string} description
 * @property {number} followersCount
 * @property {number} friendsCount
 * @property {number} statusesCount
 * @property {string} bannerUrl
 * @property {string} location
 * @property {boolean} blueVerified
 * @property {boolean} verified
 * @property {boolean} protected
 * @property {string} professionalType
 * @property {string} createdAt ISO timestamp, "" when unparseable.
 */

/**
 * @typedef {Object} ApiMedia
 * @property {string} url
 * @property {"photo" | "video"} type
 */

/**
 * @typedef {Object} ApiTweet
 * @property {string} id
 * @property {string} text
 * @property {string} url
 * @property {string} createdAt ISO timestamp, "" when unparseable.
 * @property {ApiUser} user
 * @property {ApiMedia[]} media
 * @property {{ replies: number, reposts: number, likes: number, quotes: number, bookmarks: number, views: number }} metrics
 * @property {string} conversationId
 * @property {string | null} replyTo
 * @property {string} language
 * @property {boolean} favorited
 * @property {boolean} retweeted
 * @property {boolean} bookmarked
 * @property {boolean} isQuoteStatus
 * @property {boolean} isArticle
 * @property {{ title: string, text: string, coverUrl?: string }} [article]
 */
/**
 * Narrows unknown JSON to a record. Single choke point so nested
 * traversal stays readable and type-safe without cast clutter.
 *
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
	return /** @type {Record<string, unknown>} */ (
		value && typeof value === "object" ? value : {}
	);
}

/**
 * @param {unknown} node
 * @returns {unknown[]} Timeline entries across known layouts.
 */
function timelineEntries(node) {
	const conversation = asRecord(
		asRecord(asRecord(node).data).threaded_conversation_with_injections_v2,
	);
	const instructions = Array.isArray(conversation.instructions)
		? conversation.instructions
		: [];
	const out = [];
	for (const instruction of instructions) {
		const entries = asRecord(instruction).entries;
		if (Array.isArray(entries)) {
			out.push(...entries);
		}
	}
	return out;
}

/**
 * Root entries carry itemContent directly; thread entries nest items
 * under content.items[].item.itemContent.
 *
 * @param {unknown} entry
 * @returns {unknown[]}
 */
function itemContents(entry) {
	const content = asRecord(asRecord(entry).content);
	if (content.itemContent && typeof content.itemContent === "object") {
		return [content.itemContent];
	}
	const items = Array.isArray(content.items) ? content.items : [];
	return items
		.map((item) => asRecord(asRecord(item).item).itemContent)
		.filter((itemContent) => !!itemContent);
}

/**
 * @param {unknown} itemContent
 * @returns {Record<string, unknown> | null}
 */
function tweetResult(itemContent) {
	const result = asRecord(asRecord(itemContent).tweet_results).result;
	if (!result || typeof result !== "object") {
		return null;
	}
	const record = /** @type {Record<string, unknown>} */ (result);
	return record.__typename === "Tweet" ? record : null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function textOf(value) {
	return typeof value === "string" ? value : "";
}

/**
 * @param {unknown} value
 * @returns {number} Finite numbers and digit strings; 0 otherwise.
 */
function countOf(value) {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && /^\d+$/.test(value.trim())) {
		return Number(value);
	}
	return 0;
}

/**
 * @param {Record<string, unknown>} result
 * @returns {ApiUser}
 */
function parseUser(result) {
	const user = asRecord(asRecord(asRecord(result.core).user_results).result);
	const core = asRecord(user.core);
	const avatar = asRecord(user.avatar);
	const banner = asRecord(user.banner);
	const bio = asRecord(user.profile_bio);
	const location = asRecord(user.location);
	const relationship = asRecord(user.relationship_counts);
	const tweetCounts = asRecord(user.tweet_counts);
	const verification = asRecord(user.verification);
	const professional = asRecord(user.professional);
	const createdAt = Date.parse(textOf(core.created_at));
	return {
		id: textOf(user.rest_id),
		name: textOf(core.name),
		screenName: textOf(core.screenName ?? core.screen_name),
		avatarUrl: textOf(avatar.image_url),
		description: textOf(bio.description),
		followersCount: countOf(relationship.followers),
		friendsCount: countOf(relationship.following),
		statusesCount: countOf(tweetCounts.tweets),
		bannerUrl: textOf(banner.image_url),
		location: textOf(location.location),
		blueVerified: user.is_blue_verified === true,
		verified: verification.verified === true,
		protected: asRecord(user.privacy).protected === true,
		professionalType: textOf(professional.professional_type),
		createdAt: Number.isNaN(createdAt) ? "" : new Date(createdAt).toISOString(),
	};
}

/**
 * Keeps the poster plus the single smallest mp4. Smallest on purpose:
 * this pipeline archives for humans and LLMs, not for re-broadcast —
 * the 256kbps preview carries the content at a fetchable size while
 * the 4K variant would blow every budget. HLS playlists are manifests,
 * not media — never emitted.
 *
 * @param {Record<string, unknown>} result
 * @returns {ApiMedia[]}
 */
function parseMedia(result) {
	const legacy = /** @type {Record<string, unknown>} */ (result.legacy ?? {});
	const extended = /** @type {Record<string, unknown>} */ (
		legacy.extended_entities ?? {}
	);
	const items = Array.isArray(extended.media) ? extended.media : [];
	const /** @type {ApiMedia[]} */ media = [];
	for (const raw of items) {
		const item = /** @type {Record<string, unknown>} */ (raw ?? {});
		if (item.type === "photo" && typeof item.media_url_https === "string") {
			media.push({ url: item.media_url_https, type: "photo" });
		} else if (item.type === "video" || item.type === "animated_gif") {
			media.push(...videoMedia(item));
		}
	}
	return media;
}

/**
 * Poster plus the single highest-bitrate mp4 of one video entity.
 *
 * @param {Record<string, unknown>} item extended_entities media entry.
 * @returns {ApiMedia[]}
 */
function videoMedia(item) {
	const /** @type {ApiMedia[]} */ out = [];
	if (typeof item.media_url_https === "string") {
		out.push({ url: item.media_url_https, type: "photo" });
	}
	const best = smallestMp4(item.video_info);
	if (best) {
		out.push({ url: best, type: "video" });
	}
	return out;
}

/**
 * @param {unknown} videoInfo
 * @returns {string | null} Smallest-bitrate mp4 URL, or null.
 */
function smallestMp4(videoInfo) {
	const info = /** @type {Record<string, unknown>} */ (videoInfo ?? {});
	const variants = Array.isArray(info.variants) ? info.variants : [];
	let best = null;
	let bestBitrate = Number.POSITIVE_INFINITY;
	for (const rawVariant of variants) {
		const variant = /** @type {Record<string, unknown>} */ (rawVariant ?? {});
		if (
			variant.content_type !== "video/mp4" ||
			typeof variant.url !== "string"
		) {
			continue;
		}
		if (countOf(variant.bitrate) < bestBitrate) {
			bestBitrate = countOf(variant.bitrate);
			best = variant.url;
		}
	}
	return best;
}

/**
 * Long tweets (>280 chars) truncate `legacy.full_text` — the complete
 * text lives in `note_tweet.note_tweet_results.result.text`. Prefer it
 * when present; fall back to legacy otherwise. Empty stays empty, never
 * guessed.
 *
 * @param {Record<string, unknown>} result
 * @returns {string}
 */
function noteTextOf(result) {
	const note = asRecord(
		asRecord(asRecord(result.note_tweet).note_tweet_results).result,
	);
	return textOf(note.text);
}

/**
 * The body of a long-form X Article lives one level below the tweet, at
 * `article.article_results.result` (title + DraftJS content_state +
 * media_entities). Null when the tweet is not an article.
 *
 * @param {Record<string, unknown>} result
 * @returns {Record<string, unknown> | null}
 */
function articleResultOf(result) {
	const article = asRecord(result.article);
	const articleResult = asRecord(asRecord(article.article_results).result);
	return Object.keys(articleResult).length > 0 ? articleResult : null;
}

/**
 * DraftJS entityMap arrives as an array ([{key,value}]) or an object
 * keyed by string. Look up one entity value in either shape.
 *
 * @param {unknown} entityMap
 * @param {unknown} key
 * @returns {Record<string, unknown>}
 */
function articleEntity(entityMap, key) {
	const map = /** @type {Record<string, unknown>} */ (entityMap ?? {});
	if (Array.isArray(map)) {
		for (const raw of map) {
			const entry = asRecord(raw);
			if (String(entry.key) === String(key)) {
				return asRecord(entry.value);
			}
		}
		return {};
	}
	return asRecord(map[String(key)]);
}

/**
 * @param {Record<string, unknown>} article
 * @param {string} field "media_id" | "media_key"
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function findArticleMedia(article, field, value) {
	const entities = Array.isArray(article.media_entities)
		? article.media_entities
		: [];
	for (const raw of entities) {
		const entity = asRecord(raw);
		if (String(entity[field]) === String(value)) {
			return entity;
		}
	}
	return {};
}

/**
 * Wraps one block's text per its DraftJS type. Unknown types stay plain
 * so no formatting is invented.
 *
 * @param {string} type
 * @param {string} text
 * @returns {string}
 */
function articleBlockLine(type, text) {
	if (text === "") {
		return "";
	}
	const prefixed = /** @type {Record<string, string>} */ ({
		"header-one": "# ",
		"header-two": "## ",
		"header-three": "### ",
		"header-four": "#### ",
		"unordered-list-item": "- ",
		"ordered-list-item": "1. ",
	})[type];
	if (prefixed) {
		return `${prefixed}${text}`;
	}
	if (type === "blockquote") {
		return text
			.split("\n")
			.map((line) => `> ${line}`)
			.join("\n");
	}
	if (type === "code-block") {
		return `\`\`\`\n${text}\n\`\`\``;
	}
	return text;
}

/**
 * Applies DraftJS entity ranges (links) to a block's text. Ranges are
 * sorted ascending and rebuilt from the original characters so offsets
 * never drift; unknown entities keep their raw text.
 *
 * @param {string} text
 * @param {unknown} entityRanges
 * @param {unknown} entityMap
 * @returns {string}
 */
function articleLinkedText(text, entityRanges, entityMap) {
	const ranges = (Array.isArray(entityRanges) ? entityRanges : [])
		.map((raw) => asRecord(raw))
		.sort((a, b) => countOf(a.offset) - countOf(b.offset));
	const chars = Array.from(text);
	let out = "";
	let cursor = 0;
	for (const range of ranges) {
		const start = countOf(range.offset);
		const end = start + countOf(range.length);
		if (start < cursor || start > chars.length) {
			continue;
		}
		const entity = articleEntity(entityMap, range.key);
		const data = asRecord(entity.data);
		out += chars.slice(cursor, start).join("");
		const segment = chars.slice(start, end).join("");
		out +=
			entity.type === "LINK" && typeof data.url === "string"
				? `[${segment}](${data.url})`
				: segment;
		cursor = end;
	}
	return out + chars.slice(cursor).join("");
}

/**
 * Atomic blocks carry media references; render each as an image so the
 * position inside the article survives. Non-media atomics fall back to
 * their plain text.
 *
 * @param {Record<string, unknown>} block
 * @param {unknown} entityMap
 * @param {Record<string, unknown>} article
 * @returns {string}
 */
function articleAtomicLine(block, entityMap, article) {
	const ranges = Array.isArray(block.entityRanges) ? block.entityRanges : [];
	const lines = [];
	for (const raw of ranges) {
		const entity = articleEntity(entityMap, asRecord(raw).key);
		if (entity.type !== "MEDIA") {
			continue;
		}
		const data = asRecord(entity.data);
		const items = Array.isArray(data.mediaItems) ? data.mediaItems : [];
		for (const rawItem of items) {
			const info = asRecord(
				findArticleMedia(article, "media_id", asRecord(rawItem).mediaId)
					.media_info,
			);
			if (typeof info.original_img_url === "string") {
				lines.push(`![image](${info.original_img_url})`);
			}
		}
	}
	return lines.join("\n\n");
}

/**
 * @param {unknown} rawBlock
 * @param {unknown} entityMap
 * @param {Record<string, unknown>} article
 * @returns {string}
 */
function articleBlockMarkdown(rawBlock, entityMap, article) {
	const block = asRecord(rawBlock);
	const text = textOf(block.text);
	if (block.type === "atomic") {
		const atomic = articleAtomicLine(block, entityMap, article);
		return atomic !== "" ? atomic : articleBlockLine("unstyled", text.trim());
	}
	return articleBlockLine(
		textOf(block.type),
		articleLinkedText(text, block.entityRanges, entityMap),
	);
}

/**
 * Renders DraftJS content_state to plain Markdown: headings, lists,
 * quotes, links, and inline media. Empty blocks are skipped, never
 * invented.
 *
 * @param {Record<string, unknown>} article
 * @returns {string}
 */
function renderArticleMarkdown(article) {
	const state = asRecord(article.content_state);
	const blocks = Array.isArray(state.blocks) ? state.blocks : [];
	return blocks
		.map((block) => articleBlockMarkdown(block, state.entityMap, article))
		.filter((line) => line !== "")
		.join("\n\n");
}

/**
 * Article images/gifs as media items. Article payloads only expose
 * `original_img_url`, so everything is captured as a photo (a video
 * article's poster included) — never guessed into a video URL.
 *
 * @param {Record<string, unknown>} article
 * @returns {ApiMedia[]}
 */
function articleMedia(article) {
	const entities = Array.isArray(article.media_entities)
		? article.media_entities
		: [];
	const /** @type {ApiMedia[]} */ media = [];
	for (const raw of entities) {
		const info = asRecord(asRecord(raw).media_info);
		if (typeof info.original_img_url === "string") {
			media.push({ url: info.original_img_url, type: "photo" });
		}
	}
	return media;
}

/**
 * @param {Record<string, unknown>} article
 * @returns {string}
 */
function articleCoverUrl(article) {
	const cover = asRecord(article.cover_media);
	if (typeof cover.media_key !== "string" || cover.media_key === "") {
		return "";
	}
	const media = findArticleMedia(article, "media_key", cover.media_key);
	return textOf(asRecord(media.media_info).original_img_url);
}

/**
 * Some payloads repeat the title as the first `header-one` block. Drop
 * it so the rendered body never shows the title twice.
 *
 * @param {string} text
 * @param {string} title
 * @returns {string}
 */
function stripLeadingTitle(text, title) {
	if (title === "") {
		return text;
	}
	const lines = text.split("\n\n");
	const first = (lines[0] ?? "").replace(/^#+\s*/, "");
	return first === title ? lines.slice(1).join("\n\n") : text;
}

/**
 * @param {Record<string, unknown>} article
 * @returns {{ title: string, text: string, coverUrl?: string }}
 */
function parseArticle(article) {
	const title = textOf(article.title);
	const text = stripLeadingTitle(renderArticleMarkdown(article), title);
	const coverUrl = articleCoverUrl(article);
	return coverUrl ? { title, text, coverUrl } : { title, text };
}

/**
 * The tweet-level text for an article root: title as an H1, then body.
 *
 * @param {{ title: string, text: string }} article
 * @returns {string}
 */
function articleFullText(article) {
	if (article.title === "") {
		return article.text;
	}
	return article.text === ""
		? `# ${article.title}`
		: `# ${article.title}\n\n${article.text}`;
}

/**
 * @param {Record<string, unknown>} result
 * @returns {ApiTweet | null}
 */
function parseTweetResult(result) {
	const legacy = /** @type {Record<string, unknown>} */ (result.legacy ?? {});
	const id = textOf(legacy.id_str);
	if (id === "") {
		return null;
	}
	const user = parseUser(result);
	const createdAt = Date.parse(textOf(legacy.created_at));
	const views = /** @type {Record<string, unknown>} */ (result.views ?? {});
	const note = noteTextOf(result);
	const articleRaw = articleResultOf(result);
	const article = articleRaw ? parseArticle(articleRaw) : null;
	const articleText = article ? articleFullText(article) : "";
	return {
		id,
		text:
			articleText !== ""
				? articleText
				: note !== ""
					? note
					: textOf(legacy.full_text),
		url: user.screenName ? `https://x.com/${user.screenName}/status/${id}` : "",
		createdAt: Number.isNaN(createdAt) ? "" : new Date(createdAt).toISOString(),
		user,
		media: [
			...parseMedia(result),
			...(articleRaw ? articleMedia(articleRaw) : []),
		],
		metrics: {
			replies: countOf(legacy.reply_count),
			reposts: countOf(legacy.retweet_count),
			likes: countOf(legacy.favorite_count),
			quotes: countOf(legacy.quote_count),
			bookmarks: countOf(legacy.bookmark_count),
			views: countOf(views.count),
		},
		conversationId: textOf(legacy.conversation_id_str),
		replyTo: textOf(legacy.in_reply_to_status_id_str) || null,
		language: textOf(legacy.lang),
		favorited: legacy.favorited === true,
		retweeted: legacy.retweeted === true,
		bookmarked: legacy.bookmarked === true,
		isQuoteStatus: legacy.is_quote_status === true,
		isArticle: article !== null,
		...(article ? { article } : {}),
	};
}

/**
 * Extracts tweets from a captured X timeline payload (TweetDetail and
 * siblings). Unknown layouts yield nothing rather than guesses.
 *
 * @param {unknown} payload Parsed JSON body.
 * @returns {ApiTweet[]}
 */
export function extractRawTweets(payload) {
	const tweets = [];
	const seen = new Set();
	for (const entry of timelineEntries(payload)) {
		for (const itemContent of itemContents(entry)) {
			const result = tweetResult(itemContent);
			if (!result) {
				continue;
			}
			const tweet = parseTweetResult(result);
			if (!tweet || seen.has(tweet.id)) {
				continue;
			}
			seen.add(tweet.id);
			tweets.push(tweet);
		}
	}
	return tweets;
}

/**
 * API wins per field, but its empty strings never clobber DOM-known
 * values — absent in the payload is not the same as empty in reality.
 *
 * @param {import("./model.js").TweetUser} domUser
 * @param {ApiUser} apiUser
 * @returns {import("./model.js").TweetUser}
 */
function mergeUser(domUser, apiUser) {
	const merged = /** @type {Record<string, unknown>} */ ({
		...(domUser ?? {}),
	});
	for (const key of [
		"id",
		"name",
		"screenName",
		"avatarUrl",
		"description",
		"bannerUrl",
		"location",
		"professionalType",
		"createdAt",
	]) {
		const value = asRecord(apiUser)[key];
		if (typeof value === "string" && value !== "") {
			merged[key] = value;
		}
	}
	for (const key of ["followersCount", "friendsCount", "statusesCount"]) {
		const value = asRecord(apiUser)[key];
		if (typeof value === "number") {
			merged[key] = value;
		}
	}
	for (const key of ["blueVerified", "verified", "protected"]) {
		const value = asRecord(apiUser)[key];
		if (typeof value === "boolean") {
			merged[key] = value;
		}
	}
	return /** @type {import("./model.js").TweetUser} */ (merged);
}

/**
 * Merges API truth into a DOM-built snapshot, matched by tweet id.
 * API wins for metrics, user basics, media, and reply refs; DOM-only
 * tweets and DOM-only fields are preserved, never clobbered.
 *
 * @param {import("./model.js").ThreadSnapshot} snapshot Mutated in place.
 * @param {ApiTweet[]} apiTweets
 * @returns {import("./model.js").ThreadSnapshot} The same snapshot.
 */
export function mergeApiIntoSnapshot(snapshot, apiTweets) {
	const seen = new Set((snapshot?.tweets ?? []).map((tweet) => tweet.id));
	const byId = new Map();
	for (const tweet of apiTweets ?? []) {
		if (tweet?.id && !byId.has(tweet.id)) {
			byId.set(tweet.id, tweet);
		}
	}
	for (const tweet of snapshot?.tweets ?? []) {
		const api = byId.get(tweet.id);
		if (api) {
			applyApiTweet(tweet, api);
		}
	}
	for (const api of byId.values()) {
		if (!seen.has(api.id)) {
			seen.add(api.id);
			snapshot.tweets.push(apiTweetToTweet(api));
		}
	}
	return snapshot;
}

/**
 * Converts an API tweet into a snapshot Tweet. Reply refs from the API
 * are explicit, so inferred is false exactly when a parent is known.
 *
 * @param {ApiTweet} api
 * @returns {import("./model.js").Tweet}
 */
function apiTweetToTweet(api) {
	return createTweet({
		id: api.id,
		text: api.text,
		url: api.url,
		createdAt: api.createdAt,
		user: { ...api.user },
		media: api.media.map((item) => ({ ...item })),
		metrics: { ...api.metrics },
		conversationId: api.conversationId,
		replyTo: api.replyTo,
		inferred: !api.replyTo,
		language: api.language,
		favorited: api.favorited,
		retweeted: api.retweeted,
		bookmarked: api.bookmarked,
		isQuoteStatus: api.isQuoteStatus,
		isArticle: api.isArticle,
		...(api.article ? { article: { ...api.article } } : {}),
	});
}

/**
 * Applies one API tweet onto its DOM twin: API wins per field, except
 * DOM-only content and empty API strings which never clobber.
 *
 * @param {import("./model.js").Tweet} tweet Mutated in place.
 * @param {ApiTweet} api
 */
function applyApiTweet(tweet, api) {
	tweet.metrics = { ...api.metrics };
	tweet.user = mergeUser(tweet.user, api.user);
	tweet.language = api.language;
	tweet.favorited = api.favorited;
	tweet.retweeted = api.retweeted;
	tweet.bookmarked = api.bookmarked;
	tweet.isQuoteStatus = api.isQuoteStatus;
	if (api.conversationId !== "") {
		tweet.conversationId = api.conversationId;
	}
	if (api.replyTo) {
		tweet.replyTo = api.replyTo;
		tweet.inferred = false;
	}
	if (api.createdAt !== "") {
		tweet.createdAt = api.createdAt;
	}
	if (api.text !== "") {
		tweet.text = api.text;
	}
	if (api.url !== "") {
		tweet.url = api.url;
	}
	if (api.media.length > 0) {
		tweet.media = api.media.map((item) => ({ ...item }));
	}
	if (api.article) {
		tweet.isArticle = true;
		tweet.article = { ...api.article };
	} else if (api.isArticle) {
		tweet.isArticle = true;
	}
}
