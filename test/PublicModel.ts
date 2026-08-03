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

  it("publishes full simulation evidence without rewriting legacy timelines", () => {
    const simulated: ExecutorJob = {
      id: "job-simulated",
      intentKey: "account:simulation",
      status: "SIMULATION_PASSED",
      userOpHash: `0x${"66".repeat(32)}`,
      userOpData: "0x",
      metadata: {
        simulationKind: "EXECUTE_DIRECT_MINTING_WITH_DATA_ETH_CALL",
        simulationPolicy: "REQUIRED_BEFORE_BROADCAST",
        simulationResult: "OUTER_CALL_NON_REVERTING",
        simulationPassedAt: "2026-08-03T00:00:00.000Z",
        simulationAttempts: 1,
      },
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_001_000,
    };
    const result = toPublicJob(simulated);

    assert.equal(
      result.timeline.find((step) => step.status === "SIMULATION_PASSED")
        ?.state,
      "current",
    );
    assert.equal(
      result.timeline.find((step) => step.status === "FLARE_SUBMITTED")
        ?.state,
      "pending",
    );
    assert.equal(
      result.details.simulationPolicy,
      "REQUIRED_BEFORE_BROADCAST",
    );
    assert.equal(
      result.details.simulationResult,
      "OUTER_CALL_NON_REVERTING",
    );

    const legacy = toPublicJob({
      ...simulated,
      id: "job-legacy",
      status: "SETTLED_SUCCESS",
      metadata: {},
    });
    assert.equal(
      legacy.timeline.some((step) => step.status === "SIMULATION_PASSED"),
      false,
    );
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
