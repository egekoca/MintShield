import type { JobStatus } from "../executor/state-store.js";

export type ExportedEvidenceJob = {
  id: string;
  status: JobStatus;
  details?: Record<string, unknown>;
  [key: string]: unknown;
};

export type EvidenceTimelineStep = {
  status: JobStatus;
  state: "completed" | "current" | "pending" | "attention";
};

const protectedStatuses: readonly JobStatus[] = [
  "CREATED",
  "XRPL_SIGNED",
  "XRPL_FINALIZED",
  "FDC_REQUESTED",
  "PROOF_READY",
  "SIMULATION_PASSED",
  "FLARE_SUBMITTED",
] as const;

const recoveryStatuses: readonly JobStatus[] = [
  "RECOVERY_REQUIRED",
  "RECOVERY_PAYMENT_SIGNED",
  "RECOVERY_PAYMENT_FINALIZED",
  "RECOVERY_FDC_REQUESTED",
  "RECOVERY_PROOF_READY",
  "RECOVERY_FLAG_SUBMITTED",
  "RECOVERY_FLAG_SET",
  "RECOVERY_STUCK_SUBMITTED",
  "RECOVERED",
] as const;

function hasSimulationEvidence(job: ExportedEvidenceJob) {
  return (
    job.status === "SIMULATION_PASSED" ||
    (job.details?.simulationPolicy === "REQUIRED_BEFORE_BROADCAST" &&
      typeof job.details.simulationPassedAt === "string")
  );
}

export function timelineExportedEvidenceJob(
  job: ExportedEvidenceJob,
): EvidenceTimelineStep[] {
  const visibleProtected = hasSimulationEvidence(job)
    ? protectedStatuses
    : protectedStatuses.filter((step) => step !== "SIMULATION_PASSED");
  const recoveryIndex = recoveryStatuses.indexOf(job.status);

  if (recoveryIndex !== -1) {
    return [
      ...visibleProtected.map((status) => ({
        status,
        state: "completed" as const,
      })),
      ...recoveryStatuses.map((status, index) => ({
        status,
        state:
          index < recoveryIndex
            ? ("completed" as const)
            : index === recoveryIndex
              ? status === "RECOVERY_REQUIRED"
                ? ("attention" as const)
                : ("current" as const)
              : ("pending" as const),
      })),
    ];
  }

  const currentIndex = visibleProtected.indexOf(job.status);
  const timeline: EvidenceTimelineStep[] = visibleProtected.map(
    (status, index) => ({
      status,
      state:
        currentIndex === -1
          ? ("completed" as const)
          : index < currentIndex
            ? ("completed" as const)
            : index === currentIndex
              ? ("current" as const)
              : ("pending" as const),
    }),
  );

  if (!visibleProtected.includes(job.status)) {
    timeline.push({
      status: job.status,
      state: ["SETTLED_SUCCESS", "SETTLED_FALLBACK", "RECOVERED"].includes(
        job.status,
      )
        ? "current"
        : "attention",
    });
  }

  return timeline;
}

export function withEvidenceTimeline<T extends ExportedEvidenceJob>(job: T) {
  return {
    ...job,
    timeline: timelineExportedEvidenceJob(job),
  };
}

export function summarizeExportedEvidenceJobs(
  jobs: readonly ExportedEvidenceJob[],
) {
  const byStatus = Object.fromEntries(
    [...new Set(jobs.map((job) => job.status))].map((status) => [
      status,
      jobs.filter((job) => job.status === status).length,
    ]),
  ) as Partial<Record<JobStatus, number>>;

  return {
    total: jobs.length,
    active: jobs.filter(
      (job) =>
        ![
          "SETTLED_SUCCESS",
          "SETTLED_FALLBACK",
          "RECOVERED",
          "FAILED",
        ].includes(job.status),
    ).length,
    attention: jobs.filter((job) =>
      ["DELAYED", "RECOVERY_REQUIRED", "FAILED"].includes(job.status),
    ).length,
    byStatus,
  };
}

export function evidenceIncludesSimulationRecords(
  jobs: readonly ExportedEvidenceJob[],
) {
  return jobs.some(hasSimulationEvidence);
}
