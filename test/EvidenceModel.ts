import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evidenceIncludesSimulationRecords,
  summarizeExportedEvidenceJobs,
  timelineExportedEvidenceJob,
  type ExportedEvidenceJob,
} from "../src/api/evidence-model.js";

describe("exported evidence model", () => {
  it("does not rewrite legacy settlement history with a simulation stage", () => {
    const legacy: ExportedEvidenceJob = {
      id: "legacy",
      status: "SETTLED_SUCCESS",
      details: {},
    };

    const timeline = timelineExportedEvidenceJob(legacy);
    assert.equal(
      timeline.some((step) => step.status === "SIMULATION_PASSED"),
      false,
    );
    assert.equal(timeline.at(-1)?.status, "SETTLED_SUCCESS");
    assert.equal(evidenceIncludesSimulationRecords([legacy]), false);
  });

  it("shows simulation only when the exported record contains proof", () => {
    const simulated: ExportedEvidenceJob = {
      id: "simulated",
      status: "SETTLED_FALLBACK",
      details: {
        simulationPolicy: "REQUIRED_BEFORE_BROADCAST",
        simulationPassedAt: "2026-08-04T00:00:00.000Z",
      },
    };

    const simulation = timelineExportedEvidenceJob(simulated).find(
      (step) => step.status === "SIMULATION_PASSED",
    );
    assert.equal(simulation?.state, "completed");
    assert.equal(evidenceIncludesSimulationRecords([simulated]), true);
  });

  it("expands the canonical 0xE0 recovery sequence and summarizes it", () => {
    const recovered: ExportedEvidenceJob = {
      id: "recovered",
      status: "RECOVERED",
      details: { jobKind: "bare-comparison" },
    };

    const timeline = timelineExportedEvidenceJob(recovered);
    assert.equal(
      timeline.find((step) => step.status === "RECOVERY_FLAG_SET")?.state,
      "completed",
    );
    assert.equal(timeline.at(-1)?.status, "RECOVERED");
    assert.equal(timeline.at(-1)?.state, "current");
    assert.deepEqual(summarizeExportedEvidenceJobs([recovered]), {
      total: 1,
      active: 0,
      attention: 0,
      byStatus: { RECOVERED: 1 },
    });
  });
});
