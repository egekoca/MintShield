import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  summarizeJobs,
  toPublicJob,
} from "../src/api/public-model.js";
import type { ExecutorJob } from "../src/executor/state-store.js";

describe("public status model", () => {
  it("redacts signed blobs and unknown metadata from UI responses", () => {
    const job: ExecutorJob = {
      id: "job-1",
      intentKey: "account:0",
      status: "XRPL_SIGNED",
      userOpHash: `0x${"11".repeat(32)}`,
      userOpData: `0x${"22".repeat(32)}`,
      xrplTxHash: `0x${"33".repeat(32)}`,
      metadata: {
        personalAccount: "0x1111111111111111111111111111111111111111",
        txBlob: "SIGNED_SECRET_OPERATIONAL_DATA",
        privateKey: "MUST_NOT_LEAK",
      },
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_001_000,
    };
    const publicJob = toPublicJob(job);
    const serialized = JSON.stringify(publicJob);

    assert.equal(
      publicJob.details.personalAccount,
      "0x1111111111111111111111111111111111111111",
    );
    assert.equal(serialized.includes("SIGNED_SECRET_OPERATIONAL_DATA"), false);
    assert.equal(serialized.includes("MUST_NOT_LEAK"), false);
    assert.equal(serialized.includes(job.userOpData), false);
  });

  it("marks delayed and recovery states for UI attention", () => {
    const base: ExecutorJob = {
      id: "job-2",
      intentKey: "account:1",
      status: "DELAYED",
      userOpHash: `0x${"44".repeat(32)}`,
      userOpData: "0x",
      metadata: {},
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_001_000,
    };
    const delayed = toPublicJob(base);
    assert.equal(delayed.timeline.at(-1)?.state, "attention");
  });

  it("treats a completed 0xE0 recovery as a terminal success", () => {
    const job: ExecutorJob = {
      id: "job-3",
      intentKey: "account:2",
      status: "RECOVERED",
      userOpHash: `0x${"55".repeat(32)}`,
      userOpData: "0x",
      metadata: {
        recoveryXrplTxHash: `0x${"44".repeat(32)}`,
        recoveryTxBlob: "SHOULD_NOT_LEAK",
      },
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_001_000,
    };
    const result = toPublicJob(job);
    const recovered = result.timeline.at(-1);

    assert.equal(recovered?.status, "RECOVERED");
    assert.equal(recovered?.state, "current");
    assert.equal(
      result.timeline.find((step) => step.status === "RECOVERY_FLAG_SET")
        ?.state,
      "completed",
    );
    assert.equal(result.details.recoveryTxBlob, undefined);
    assert.equal(summarizeJobs([job]).active, 0);
  });
});
