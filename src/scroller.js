/**
 * Auto-expand loop for thread capture (Task 3).
 * Classic script on purpose, like x-adapter.js: exposes `XScroller` on
 * globalThis for the content script. Clicks "show more" affordances and
 * scrolls in batches until the timeline stops growing or a limit hits.
 */

/**
 * @typedef {Object} ExpandOptions
 * @property {number} [maxBatches] Hard cap on iterations (default 40).
 * @property {number} [batchDelayMs] Settle time per batch (default 800).
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
		batchDelayMs = 800,
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
		if (idleBatches >= 2) {
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
 * @param {ParentNode} doc
 */
function scrollOnce(doc) {
	/** @type {Element | null} */
	const target =
		doc === document
			? (document.scrollingElement ?? document.body)
			: doc instanceof Element
				? doc
				: null;
	if (target) {
		target.scrollTop = target.scrollHeight;
	}
}

globalThis.XScroller = { expandAndScroll };
