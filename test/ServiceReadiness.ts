import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildServiceReadiness } from "../src/api/service-readiness.js";

describe("service readiness", () => {
  it("describes the public deployment without implying signing support", () => {
    const readiness = buildServiceReadiness({
      deploymentMode: "public-evidence",
      xamanConfigured: false,
      evidence: {
        exportedAt: "2026-07-30T00:00:00.000Z",
        total: 4,
        settledSuccess: 1,
        settledFallback: 2,
        recovered: 1,
        includesSimulationRecords: false,
      },
    });

    assert.equal(readiness.status, "READ_ONLY_READY");
    assert.equal(readiness.capabilities.livePreview, "AVAILABLE");
    assert.equal(readiness.capabilities.onchainEvidence, "AVAILABLE");
    assert.equal(readiness.capabilities.xamanSigning, "DISABLED");
    assert.equal(readiness.capabilities.durableJobStore, "DISABLED");
    assert.equal(readiness.evidence?.includesSimulationRecords, false);
  });

  it("reports a configured local operator without claiming worker liveness", () => {
    const readiness = buildServiceReadiness({
      deploymentMode: "durable-executor",
      xamanConfigured: true,
    });

    assert.equal(readiness.status, "OPERATOR_READY");
    assert.equal(readiness.capabilities.xamanSigning, "AVAILABLE");
    assert.equal(readiness.capabilities.durableJobStore, "AVAILABLE");
    assert.equal(readiness.capabilities.onchainEvidence, "AVAILABLE");
    assert.equal(
      readiness.capabilities.executorWorker,
      "EXTERNAL_PROCESS_REQUIRED",
    );
    assert.equal(
      readiness.capabilities.fullCallSimulation,
      "ENFORCED_BY_EXECUTOR",
    );
  });
});
