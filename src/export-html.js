/**
 * HTML + Markdown exporters (Task 5). Pure functions over an enriched
 * ThreadSnapshot (media may carry localPath/captionText/unresolved).
 * Both outputs are offline-first: no external stylesheets, scripts,
 * fonts, or remote dependencies — only relative links to local files
 * plus hyperlinks back to the original URLs.
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * @param {import("./model.js").Tweet} tweet
 * @returns {string} e.g. "@user (Name)".
 */
function authorLabel(tweet) {
	const screenName = tweet.user?.screenName || "unknown";
	const name = tweet.user?.name ? ` (${tweet.user.name})` : "";
	return `@${screenName}${name}`;
}

/**
 * @param {import("./model.js").TweetMetrics} metrics
 * @returns {string}
 */
function metricsText(metrics) {
	const m = metrics ?? { replies: 0, reposts: 0, likes: 0, views: 0 };
	return `${m.likes} likes · ${m.reposts} reposts · ${m.replies} replies · ${m.views} views`;
}

/**
 * @param {import("./model.js").Tweet} tweet
 * @returns {string} Reply context line, "" for the thread root.
 */
function replyLine(tweet) {
	if (!tweet.replyTo) {
		return "";
	}
	return `In reply to ${tweet.replyTo}`;
}

/**
 * @param {import("./model.js").TweetMedia[]} media
 * @returns {string} HTML fragment (already escaped).
 */
function mediaHtml(media) {
	const parts = [];
	for (const item of media ?? []) {
		if (item.type === "photo") {
			parts.push(photoHtml(item));
		} else if (item.type === "video") {
			parts.push(videoHtml(item));
		} else if (item.type === "captions") {
			parts.push(captionsHtml(item));
		}
	}
	return parts.join("\n");
}

/**
 * @param {import("./model.js").TweetMedia} item
 * @returns {string}
 */
function photoHtml(item) {
	if (item.localPath) {
		return `<img src="${escapeHtml(item.localPath)}" alt="photo" loading="lazy">`;
	}
	return `<p>Photo (not downloaded): <a href="${escapeHtml(item.url)}">original</a></p>`;
}

/**
 * @param {import("./model.js").TweetMedia} item
 * @returns {string}
 */
function videoHtml(item) {
	if (item.localPath) {
		return `<video controls preload="none" src="${escapeHtml(item.localPath)}"></video>`;
	}
	return `<p>Video not downloadable (${escapeHtml(item.unresolved ?? "unknown reason")}): <a href="${escapeHtml(item.url)}">original</a></p>`;
}

/**
 * @param {import("./model.js").TweetMedia} item
 * @returns {string}
 */
function captionsHtml(item) {
	if (item.captionText) {
		return `<blockquote>${escapeHtml(item.captionText)}</blockquote>`;
	}
	if (item.localPath) {
		return `<p>Captions: <a href="${escapeHtml(item.localPath)}">subtitle file</a></p>`;
	}
	return "";
}

/**
 * @param {import("./model.js").TweetMedia[]} media
 * @returns {string} Markdown fragment.
 */
function mediaMarkdown(media) {
	const lines = [];
	for (const item of media ?? []) {
		if (item.type === "photo") {
			lines.push(photoMarkdown(item));
		} else if (item.type === "video") {
			lines.push(videoMarkdown(item));
		} else if (item.type === "captions") {
			lines.push(captionsMarkdown(item));
		}
	}
	return lines.filter((line) => line !== "").join("\n");
}

/**
 * @param {import("./model.js").TweetMedia} item
 * @returns {string}
 */
function photoMarkdown(item) {
	return item.localPath
		? `![photo](${item.localPath})`
		: `[photo (original)](${item.url})`;
}

/**
 * @param {import("./model.js").TweetMedia} item
 * @returns {string}
 */
function videoMarkdown(item) {
	if (item.localPath) {
		return `[video file](${item.localPath})`;
	}
	return `Video not downloadable (${item.unresolved ?? "unknown reason"}): ${item.url}`;
}

/**
 * @param {import("./model.js").TweetMedia} item
 * @returns {string}
 */
function captionsMarkdown(item) {
	if (item.captionText) {
		return item.captionText
			.split("\n")
			.map((line) => `> ${line}`)
			.join("\n");
	}
	if (item.localPath) {
		return `[captions (subtitle file)](${item.localPath})`;
	}
	return "";
}

/**
 * @param {import("./model.js").ThreadSnapshot} snapshot
 * @returns {string} Standalone offline HTML document.
 */
export function renderThreadHtml(snapshot) {
	const tweets = snapshot?.tweets ?? [];
	const cards = tweets
		.map((tweet) => {
			const replied = replyLine(tweet);
			const inferred =
				!tweet.replyTo && tweet.inferred
					? `<p class="note">Order from the page; reply target unknown.</p>`
					: "";
			return `<article>
<header><strong>${escapeHtml(authorLabel(tweet))}</strong> · <time>${escapeHtml((tweet.createdAt ?? "").slice(0, 10))}</time> · <a href="${escapeHtml(tweet.url)}">original</a></header>
<p class="text">${escapeHtml(tweet.text)}</p>
${replied ? `<p class="note">${escapeHtml(replied)}</p>` : ""}
${inferred}
${mediaHtml(tweet.media)}
<footer>${escapeHtml(metricsText(tweet.metrics))}</footer>
</article>`;
		})
		.join("\n");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(snapshot?.sourceUrl ?? "thread")}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:40rem;margin:0 auto;padding:1rem;line-height:1.5}
article{border-top:1px solid #ccc;padding:1rem 0}
img,video{max-width:100%}
.text{white-space:pre-wrap}
.note{color:#555;font-size:.85rem}
blockquote{border-left:3px solid #ccc;margin:1rem 0;padding-left:1rem;white-space:pre-wrap}
footer{color:#555;font-size:.85rem}
</style>
</head>
<body>
<h1>Thread (${tweets.length} tweets)</h1>
<p>Source: <a href="${escapeHtml(snapshot?.sourceUrl ?? "")}">${escapeHtml(snapshot?.sourceUrl ?? "")}</a><br>Scraped: ${escapeHtml(snapshot?.scrapedAt ?? "")}</p>
${cards}
</body>
</html>
`;
}

/**
 * Human-readable media inventory: how many files, where each lives
 * locally (or why it doesn't), and the original URL for manual fetch.
 * LLMs cannot download, so this is the list to act on.
 *
 * @param {import("./model.js").ThreadSnapshot} snapshot Enriched (localPath/unresolved).
 * @returns {string}
 */
export function renderMediaList(snapshot) {
	const tweets = snapshot?.tweets ?? [];
	const sections = [];
	let files = 0;
	let unresolved = 0;
	for (const tweet of tweets) {
		const media = tweet.media ?? [];
		if (media.length === 0) {
			continue;
		}
		const lines = [];
		for (const item of media) {
			files += 1;
			if (item.unresolved) {
				unresolved += 1;
			}
			lines.push(mediaListLine(item));
		}
		sections.push(
			`## ${authorLabel(tweet)}\n\n${tweet.url}\n\n${lines.join("\n")}`,
		);
	}
	const head =
		unresolved > 0
			? `# Media (${files} files, ${unresolved} unresolved)`
			: `# Media (${files} files)`;
	if (sections.length === 0) {
		return `${head}\n`;
	}
	return `${head}\n\n${sections.join("\n\n")}\n`;
}

/**
 * One inventory line per media item: local path when downloaded,
 * original URL always (for manual fetch), reason when absent.
 *
 * @param {import("./model.js").TweetMedia} item
 * @returns {string}
 */
function mediaListLine(item) {
	const location = item.localPath
		? item.localPath
		: `(not downloaded: ${item.unresolved ?? "unknown reason"})`;
	return `- ${item.type}: ${location}\n  original: ${item.url}`;
}

/**
 * @param {import("./model.js").ThreadSnapshot} snapshot
 * @returns {string} Plain Markdown, LLM-upload friendly.
 */
export function renderThreadMarkdown(snapshot) {
	const tweets = snapshot?.tweets ?? [];
	const sections = tweets.map((tweet) => {
		const replied = replyLine(tweet);
		const inferred =
			!tweet.replyTo && tweet.inferred
				? "\n\n_Order from the page; reply target unknown._"
				: "";
		const media = mediaMarkdown(tweet.media);
		return `## ${authorLabel(tweet)} — ${(tweet.createdAt ?? "").slice(0, 10)}

${tweet.url}

${tweet.text}${replied ? `\n\n${replied}` : ""}${inferred}${media ? `\n\n${media}` : ""}

*${metricsText(tweet.metrics)}*`;
	});
	return `# Thread (${tweets.length} tweets)

Source: ${snapshot?.sourceUrl ?? ""}
Scraped: ${snapshot?.scrapedAt ?? ""}

${sections.join("\n\n---\n\n")}
`;
}
