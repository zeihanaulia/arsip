/** Task 1 popup stub: proves the popup can reach the content script. */
import { createMessage, isMessage, MESSAGE_TYPES } from "./messaging.js";

const statusEl = document.querySelector("#status");
const pingButton = document.querySelector("#ping");

pingButton?.addEventListener("click", async () => {
	setStatus("checking…");
	setStatus(await pingContentScript());
});

/**
 * @param {string} text
 */
function setStatus(text) {
	if (statusEl) {
		statusEl.textContent = text;
	}
}

/**
 * @returns {Promise<string>}
 */
async function pingContentScript() {
	try {
		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});
		if (tab?.id === undefined) {
			return "no active tab";
		}
		const reply = await chrome.tabs.sendMessage(
			tab.id,
			createMessage(MESSAGE_TYPES.PING),
		);
		return isMessage(reply) && reply.payload.connected === true
			? "connected: true"
			: "connected: false";
	} catch (error) {
		return error instanceof Error
			? `not reachable: ${error.message}`
			: "content script not reachable on this page";
	}
}
