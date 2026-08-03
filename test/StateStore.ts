import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress, keccak256 } from "viem";
import { createProtectedMintJob } from "../src/executor/pipeline.js";
import { ExecutorStateStore } from "../src/executor/state-store.js";

const userOpHash = `0x${"11".repeat(32)}` as const;
const userOpData = `0x${"22".repeat(64)}` as const;
const xrplTxHash = `0x${"33".repeat(32)}` as const;

describe("ExecutorStateStore", () => {
  it("creates an idempotent job for the same intent and payload", () => {
    const store = new ExecutorStateStore(":memory:");
    try {
      const first = store.createOrGet({
        id: "job-1",
        intentKey: "account:7",
        userOpHash,
        userOpData,
      });
      const second = store.createOrGet({
        intentKey: "account:7",
        userOpHash,
        userOpData,
      });

      assert.equal(first.created, true);
      assert.equal(second.created, false);
      assert.equal(second.job.id, first.job.id);
    } finally {
      store.close();
    }
  });

  it("rejects intent-key reuse with a different payload", () => {
    const store = new ExecutorStateStore(":memory:");
    try {
      store.createOrGet({
        intentKey: "account:7",
        userOpHash,
        userOpData,
      });
      assert.throws(
        () =>
          store.createOrGet({
            intentKey: "account:7",
            userOpHash: `0x${"44".repeat(32)}`,
            userOpData,
          }),
        /different user-op data/,
      );
    } finally {
      store.close();
    }
  });

  it("enforces the state machine and persists retry time", () => {
    const store = new ExecutorStateStore(":memory:");
    try {
      const { job } = store.createOrGet({
        intentKey: "account:8",
        userOpHash,
        userOpData,
      });
      const signed = store.transition(job.id, "XRPL_SIGNED", { xrplTxHash });
      store.transition(job.id, "XRPL_FINALIZED");
      store.transition(job.id, "FDC_REQUESTED", {
        fdcRequest: `0x${"55".repeat(40)}`,
        votingRound: 12,
      });
      store.transition(job.id, "PROOF_READY");
      store.transition(job.id, "SIMULATION_PASSED", {
        metadata: {
          simulationPolicy: "REQUIRED_BEFORE_BROADCAST",
          simulationPassedAt: "2026-08-03T00:00:00.000Z",
        },
      });
      store.transition(job.id, "FLARE_SUBMITTED", {
        flareTxHash: `0x${"66".repeat(32)}`,
      });
      const delayed = store.transition(job.id, "DELAYED", {
        executionAllowedAt: 2_000n,
      });

      assert.equal(signed.xrplTxHash, xrplTxHash);
      assert.equal(delayed.executionAllowedAt, 2_000n);
      assert.deepEqual(store.listRunnable(1_999n), []);
      assert.equal(store.listRunnable(2_000n)[0]?.id, job.id);
      assert.throws(
        () => store.transition(job.id, "XRPL_FINALIZED"),
        /Invalid executor transition/,
      );
    } finally {
      store.close();
    }
  });

  it("allows idempotent updates without advancing state", () => {
    const store = new ExecutorStateStore(":memory:");
    try {
      const { job } = store.createOrGet({
        intentKey: "account:9",
        userOpHash,
        userOpData,
      });
      const updated = store.transition(job.id, "CREATED", {
        metadata: { attempts: 1n },
      });
      assert.deepEqual(updated.metadata, { attempts: "1" });
    } finally {
      store.close();
    }
  });

  it("binds a Xaman payload UUID to exactly one durable job lookup", () => {
    const store = new ExecutorStateStore(":memory:");
    try {
      const { job } = store.createOrGet({
        intentKey: "account:xaman",
        userOpHash,
        userOpData,
        metadata: {
          xamanPayloadUuid: "11111111-1111-4111-8111-111111111111",
        },
      });
      assert.equal(
        store.getByXamanPayloadUuid(
          "11111111-1111-4111-8111-111111111111",
        )?.id,
        job.id,
      );
      assert.equal(
        store.getByXamanPayloadUuid(
          "22222222-2222-4222-8222-222222222222",
        ),
        undefined,
      );
    } finally {
      store.close();
    }
  });

  it("creates a browser signing job without an XRPL wallet secret", () => {
    const store = new ExecutorStateStore(":memory:");
    try {
      const data = "0x1234" as const;
      const hash = keccak256(data);
      const memoData =
        `0xfe00${"00".repeat(8)}${hash.slice(2)}` as const;
      const created = createProtectedMintJob(store, {
        intentKey: "account:browser",
        userOpHash: hash,
        userOpData: data,
        memoData,
        router: getAddress(
          "0x1000000000000000000000000000000000000001",
        ),
        personalAccount: getAddress(
          "0x2000000000000000000000000000000000000002",
        ),
        nonce: 4n,
        xrplSourceAccount: "rExpectedSource",
        coreVaultAddress: "rExpectedCoreVault",
        paymentAmountDrops: 1_100_000n,
      });

      assert.equal(created.job.status, "CREATED");
      assert.equal(
        created.job.metadata.xrplSourceAccount,
        "rExpectedSource",
      );
      assert.equal("txBlob" in created.job.metadata, false);
    } finally {
      store.close();
    }
  });

  it("persists the durable 0xE0 recovery state machine", () => {
    const store = new ExecutorStateStore(":memory:");
    try {
      const { job } = store.createOrGet({
        intentKey: "account:10",
        userOpHash,
        userOpData,
      });
      store.transition(job.id, "XRPL_SIGNED", { xrplTxHash });
      store.transition(job.id, "XRPL_FINALIZED");
      store.transition(job.id, "FDC_REQUESTED", {
        fdcRequest: `0x${"55".repeat(40)}`,
        votingRound: 13,
      });
      store.transition(job.id, "PROOF_READY");
      store.transition(job.id, "FLARE_SUBMITTED", {
        flareTxHash: `0x${"66".repeat(32)}`,
      });
      store.transition(job.id, "RECOVERY_REQUIRED");
      store.transition(job.id, "RECOVERY_PAYMENT_SIGNED");
      store.transition(job.id, "RECOVERY_PAYMENT_FINALIZED");
      store.transition(job.id, "RECOVERY_FDC_REQUESTED");
      store.transition(job.id, "RECOVERY_PROOF_READY");
      store.transition(job.id, "RECOVERY_FLAG_SUBMITTED");
      store.transition(job.id, "RECOVERY_FLAG_SET");
      store.transition(job.id, "RECOVERY_STUCK_SUBMITTED");
      const recovered = store.transition(job.id, "RECOVERED", {
        metadata: { recoveredStuckAmount: "1000000" },
      });

      assert.equal(recovered.status, "RECOVERED");
      assert.equal(recovered.metadata.recoveredStuckAmount, "1000000");
      assert.deepEqual(store.listRunnable(0n), []);
      const released = store.releaseRecoveredIntentKey(job.id);
      assert.equal(released.metadata.originalIntentKey, "account:10");
      assert.equal(
        released.intentKey,
        `account:10:recovered:${job.id}`,
      );
      assert.equal(
        store.releaseRecoveredIntentKey(job.id).intentKey,
        released.intentKey,
      );
    } finally {
      store.close();
    }
  });

  it("refuses to release an active intent key", () => {
    const store = new ExecutorStateStore(":memory:");
    try {
      const { job } = store.createOrGet({
        intentKey: "account:11",
        userOpHash,
        userOpData,
      });
      assert.throws(
        () => store.releaseRecoveredIntentKey(job.id),
        /only be released after recovery/,
      );
    } finally {
      store.close();
    }
  });
});
