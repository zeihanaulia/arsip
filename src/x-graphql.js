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
 * Keeps the poster plus the single highest-bitrate mp4. HLS playlists
 * are manifests, not media — never emitted.
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
	const best = bestMp4(item.video_info);
	if (best) {
		out.push({ url: best, type: "video" });
	}
	return out;
}

/**
 * @param {unknown} videoInfo
 * @returns {string | null} Highest-bitrate mp4 URL, or null.
 */
function bestMp4(videoInfo) {
	const info = /** @type {Record<string, unknown>} */ (videoInfo ?? {});
	const variants = Array.isArray(info.variants) ? info.variants : [];
	let best = null;
	let bestBitrate = -1;
	for (const rawVariant of variants) {
		const variant = /** @type {Record<string, unknown>} */ (rawVariant ?? {});
		if (
			variant.content_type !== "video/mp4" ||
			typeof variant.url !== "string"
		) {
			continue;
		}
		if (countOf(variant.bitrate) > bestBitrate) {
			bestBitrate = countOf(variant.bitrate);
			best = variant.url;
		}
	}
	return best;
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
	return {
		id,
		text: textOf(legacy.full_text),
		url: user.screenName ? `https://x.com/${user.screenName}/status/${id}` : "",
		createdAt: Number.isNaN(createdAt) ? "" : new Date(createdAt).toISOString(),
		user,
		media: parseMedia(result),
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
}
