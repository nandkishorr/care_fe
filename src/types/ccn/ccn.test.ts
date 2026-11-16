import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BecknMessage,
  extractNetworkOffers,
  isAwaitingCallback,
  isFailedTransaction,
  networkOfferLabel,
  transactionErrorText,
} from "@/types/ccn/ccn";

function onDiscover(
  context: Record<string, unknown>,
  catalogs: unknown[],
): BecknMessage {
  return {
    id: 1,
    transaction_id: "txn-1",
    message_id: "m-1",
    action: "on_discover",
    direction: "in",
    delivery_status: "",
    processing_status: "processed",
    attempts: 0,
    last_error: "",
    payload: { context, message: { catalogs } },
    ack: null,
    reply_to: null,
    created_date: null,
    modified_date: null,
  };
}

const envelope = {
  networkId: "nfh",
  bapId: "care.bap",
  bapUri: "https://care/bap",
  bppId: "cc.bpp",
  bppUri: "https://cc/bpp",
};

test("offers keep the routing of the envelope that returned them", () => {
  const offers = extractNetworkOffers([
    onDiscover(envelope, [
      {
        descriptor: { name: "Coordination catalog" },
        provider: { id: "facility-1", descriptor: { name: "District CC" } },
        offers: [{ id: "offer-1", descriptor: { name: "Consultation" } }],
      },
    ]),
  ]);
  assert.equal(offers.length, 1);
  assert.deepEqual(offers[0].context, {
    network_id: "nfh",
    bap_id: "care.bap",
    bap_uri: "https://care/bap",
    bpp_id: "cc.bpp",
    bpp_uri: "https://cc/bpp",
  });
  assert.equal(offers[0].transactionId, "txn-1");
  assert.equal(offers[0].providerId, "facility-1");
  assert.equal(networkOfferLabel(offers[0]), "District CC — Consultation");
});

test("a catalog's own BPP wins over the envelope's", () => {
  const [offer] = extractNetworkOffers([
    onDiscover(envelope, [
      { bppId: "other.bpp", bppUri: "https://other", offers: [{ id: "o" }] },
    ]),
  ]);
  assert.equal(offer.context.bpp_id, "other.bpp");
  assert.equal(offer.context.bpp_uri, "https://other");
  assert.equal(networkOfferLabel(offer), "o");
});

test("offers without an id and malformed catalogs are skipped", () => {
  const offers = extractNetworkOffers([
    onDiscover(envelope, [null, "x", { offers: [{}, { id: "" }] }]),
    {
      ...onDiscover(envelope, []),
      payload: { context: envelope },
    },
  ]);
  assert.deepEqual(offers, []);
});

test("transaction statuses", () => {
  assert.equal(isAwaitingCallback("QUEUED"), true);
  assert.equal(isAwaitingCallback("SELECT"), true);
  assert.equal(isAwaitingCallback("ON_SELECT"), false);
  assert.equal(isAwaitingCallback("UPDATE"), true);
  assert.equal(isAwaitingCallback("ON_UPDATE"), false);
  assert.equal(isAwaitingCallback("NACK"), false);
  assert.equal(isAwaitingCallback(undefined), false);
  assert.equal(isFailedTransaction("ERROR"), true);
  assert.equal(isFailedTransaction("ON_CONFIRM"), false);
});

test("gateway errors are shortened for display", () => {
  assert.equal(transactionErrorText(null), undefined);
  assert.equal(
    transactionErrorText({ code: "NOT_CONFIGURED" }),
    "NOT_CONFIGURED",
  );
  const text = transactionErrorText({ message: "x".repeat(500) }, 10);
  assert.equal(text, `${"x".repeat(10)}…`);
});
