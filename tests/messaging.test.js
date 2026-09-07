import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMessage, isMessage, MESSAGE_TYPES } from "../src/messaging.js";

describe("MESSAGE_TYPES", () => {
	it("covers the scrape lifecycle agreed in the plan", () => {
		assert.deepEqual(
			{ ...MESSAGE_TYPES },
			{
				PING: "PING",
				SCRAPE_START: "SCRAPE_START",
				SCRAPE_PROGRESS: "SCRAPE_PROGRESS",
				SCRAPE_STATUS: "SCRAPE_STATUS",
				SCRAPE_CANCEL: "SCRAPE_CANCEL",
				SCRAPE_DONE: "SCRAPE_DONE",
				SCRAPE_ERROR: "SCRAPE_ERROR",
			},
		);
	});

	it("is frozen so popup and content script cannot drift apart", () => {
		assert.ok(Object.isFrozen(MESSAGE_TYPES));
	});
});

describe("createMessage", () => {
	it("wraps type and payload in the agreed envelope", () => {
		assert.deepEqual(createMessage("PING", { connected: true }), {
			type: "PING",
			payload: { connected: true },
		});
	});

	it("defaults missing payload to an empty object", () => {
		assert.deepEqual(createMessage("SCRAPE_START"), {
			type: "SCRAPE_START",
			payload: {},
		});
	});

	it("throws on unknown types instead of sending garbage", () => {
		assert.throws(() => createMessage("NOPE"), /Unknown message type/);
	});
});

describe("isMessage", () => {
	it("accepts well-formed envelopes", () => {
		assert.equal(isMessage({ type: "PING", payload: {} }), true);
	});

	it("rejects anything else", () => {
		assert.equal(isMessage(null), false);
		assert.equal(isMessage({ type: "PING" }), false);
		assert.equal(isMessage({ type: "NOPE", payload: {} }), false);
		assert.equal(isMessage("PING"), false);
	});
});
