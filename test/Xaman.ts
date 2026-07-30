import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildXamanPaymentPayload,
  createXamanSignRequest,
  loadOptionalXamanCredentials,
  toPublicXamanStatus,
} from "../src/xaman/client.js";

const preview = {
  source: {
    xrplAddress: "rSource",
    destination: "rDestination",
  },
  intent: {
    inputAmountFxrp: "1",
  },
  quote: {
    paymentAmountDrops: "1100000",
    paymentAmountXrp: "1.1",
  },
  commitment: {
    userOpHash: `0x${"11".repeat(32)}`,
    memoData: `0x${"fe"}${"00".repeat(9)}${"11".repeat(32)}`,
  },
};

describe("Xaman signing integration", function () {
  it("keeps signing disabled until the explicit backend gate is enabled", function () {
    assert.equal(
      loadOptionalXamanCredentials({
        XAMAN_API_KEY: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        XAMAN_API_SECRET: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
      undefined,
    );
    assert.deepEqual(
      loadOptionalXamanCredentials({
        XAMAN_ENABLE_SIGNING: "true",
        XAMAN_API_KEY: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        XAMAN_API_SECRET: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
      {
        apiKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        apiSecret: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
    );
  });

  it("builds an exact Testnet Payment template without wallet secrets", function () {
    const payload = buildXamanPaymentPayload({
      preview,
      identifier: "11111111-1111-4111-8111-111111111111",
    });

    assert.equal(payload.txjson.TransactionType, "Payment");
    assert.equal(payload.txjson.Destination, "rDestination");
    assert.equal(payload.txjson.Amount, "1100000");
    assert.equal(
      payload.txjson.Memos[0]?.Memo.MemoData,
      preview.commitment.memoData.slice(2).toUpperCase(),
    );
    assert.equal(payload.options.force_network, "TESTNET");
    assert.equal(payload.options.submit, true);
    assert.equal("Account" in payload.txjson, false);
    assert.equal(JSON.stringify(payload).includes("secret"), false);
  });

  it("authenticates server-side and returns only allowlisted Xaman URLs", async function () {
    let observedHeaders: Headers | undefined;
    const request = await createXamanSignRequest({
      credentials: {
        apiKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        apiSecret: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
      payload: buildXamanPaymentPayload({
        preview,
        identifier: "11111111-1111-4111-8111-111111111111",
      }),
      fetchImpl: async (_url, init) => {
        observedHeaders = new Headers(init?.headers);
        return Response.json({
          uuid: "22222222-2222-4222-8222-222222222222",
          next: { always: "https://xumm.app/sign/example" },
          refs: {
            qr_png: "https://xumm.app/sign/example_q.png",
            websocket_status: "wss://xumm.app/sign/example",
          },
          pushed: false,
        });
      },
    });

    assert.equal(
      observedHeaders?.get("x-api-key"),
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    assert.equal(
      observedHeaders?.get("x-api-secret"),
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    assert.equal(request.uuid, "22222222-2222-4222-8222-222222222222");
    assert.equal("apiSecret" in request, false);
  });

  it("redacts signed blobs and requires signer, Testnet and txid checks", function () {
    const status = toPublicXamanStatus({
      meta: { resolved: true, signed: true },
      custom_meta: { blob: { xrplAddress: "rSource" } },
      response: {
        account: "rSource",
        txid: "AA".repeat(32),
        dispatched_nodetype: "TESTNET",
        hex: "SHOULD_NOT_LEAK",
      },
    });

    assert.equal(status.resolved, true);
    assert.equal(status.checks.signerMatches, true);
    assert.equal(status.checks.testnet, true);
    assert.equal(status.checks.hasTransactionId, true);
    assert.equal(JSON.stringify(status).includes("SHOULD_NOT_LEAK"), false);
  });
});
