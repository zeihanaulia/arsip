/**
 * Auto-expand loop for thread capture (Task 3).
 * Classic script on purpose, like x-adapter.js: exposes `XScroller` on
 * globalThis for the content script. Clicks "show more" affordances and
 * scrolls in batches until the timeline stops growing or a limit hits.
 */

/**
 * @typedef {Object} ExpandOptions
 * @property {number} [maxBatches] Hard cap on iterations (default 40).
 * @property {number} [batchDelayMs] Settle time per batch (default 1500).
 * @property {number} [maxIdleBatches] Give up after this many batches
 *   without growth (default 4). Separate from maxBatches so patience
 *   against slow chunks is tunable without raising the hard cap.
 * @property {number} [maxTweets] Stop once this many tweets load (default 300).
 * @property {() => boolean} [shouldStop] Cooperative cancel hook.
 */

/**
 * @typedef {Object} ScrollStats
 * @property {number} clicked Expand buttons clicked.
 * @property {number} batches Batches executed.
 * @property {number} tweets Tweets loaded when stopping.
 * @property {string} stoppedWhy "idle" | "max-batches" | "max-tweets" | "cancelled".
 */

/**
 * @param {ParentNode} root
 * @returns {number}
 */
function countTweets(root) {
	const adapter = globalThis.XAdapter;
	return adapter.findTweetElements(root).length;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * Click expand buttons, scroll, and wait for the timeline to settle.
 * Stops early when two consecutive batches add nothing.
 *
 * @param {ParentNode} [root]
 * @param {ExpandOptions} [options]
 * @param {(stats: ScrollStats) => void} [onProgress]
 * @returns {Promise<ScrollStats>}
 */
async function expandAndScroll(root, options = {}, onProgress) {
	const doc = root ?? document;
	const {
		maxBatches = 40,
		batchDelayMs = 1500,
		maxIdleBatches = 4,
		maxTweets = 300,
		shouldStop = () => false,
	} = options;
	const stats = { clicked: 0, batches: 0, tweets: 0, stoppedWhy: "idle" };
	let idleBatches = 0;
	let previous = countTweets(doc);

	for (let batch = 0; batch < maxBatches; batch += 1) {
		if (shouldStop()) {
			stats.stoppedWhy = "cancelled";
			break;
		}
		for (const button of globalThis.XAdapter.findExpandButtons(doc)) {
			button.click();
			stats.clicked += 1;
		}
		scrollOnce(doc);
		await sleep(batchDelayMs);
		stats.batches = batch + 1;
		stats.tweets = countTweets(doc);
		onProgress?.({ ...stats });
		if (stats.tweets >= maxTweets) {
			stats.stoppedWhy = "max-tweets";
			break;
		}
		idleBatches = stats.tweets > previous ? 0 : idleBatches + 1;
		previous = stats.tweets;
		if (idleBatches >= maxIdleBatches) {
			stats.stoppedWhy = "idle";
			break;
		}
		if (batch === maxBatches - 1) {
			stats.stoppedWhy = "max-batches";
		}
	}
	return stats;
}

/**
 * Scrolls every loaded tweet into view so lazily-mounted players
 * (preload="none" video, etc.) get created before the final scrape.
 * Cheap when nothing is lazy: one pass, one settle wait.
 *
 * @param {ParentNode} [root]
 * @param {{ settleMs?: number }} [options]
 * @returns {Promise<number>} Tweet count after mounting.
 */
async function mountLazyMedia(root, options = {}) {
	const { settleMs = 1500 } = options;
	const doc = root ?? document;
	for (const article of globalThis.XAdapter.findTweetElements(doc)) {
		if (
			article instanceof Element &&
			typeof article.scrollIntoView === "function"
		) {
			article.scrollIntoView({ block: "center" });
		}
	}
	await sleep(settleMs);
	return countTweets(doc);
}

/**
 * Finds what actually scrolls the timeline: the nearest ancestor of the
 * first tweet with real scrollable overflow. X virtualizes its timeline
 * in an inner container, so scrolling the document never triggers the
 * next chunk there. Falls back to the document scroller.
 *
 * @param {ParentNode} doc
 * @returns {Element} Scroll target (never the document itself).
 */
function findScrollContainer(doc) {
	const first =
		doc === document
			? document.querySelector('article[data-testid="tweet"]')
			: null;
	let node = first?.parentElement ?? null;
	while (node) {
		if (node.scrollHeight - node.clientHeight > 50) {
			return node;
		}
		node = node.parentElement;
	}
	return document.scrollingElement ?? document.body;
}

/**
 * @param {ParentNode} doc
 */
function scrollOnce(doc) {
	const target =
		doc === document
			? findScrollContainer(doc)
			: doc instanceof Element
				? doc
				: null;
	if (target) {
		target.scrollTop = target.scrollHeight;
	}
}

globalThis.XScroller = { expandAndScroll, mountLazyMedia };
