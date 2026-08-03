export type DeploymentMode = "public-evidence" | "durable-executor";

export type CapabilityState =
  | "AVAILABLE"
  | "DISABLED"
  | "EXTERNAL_PROCESS_REQUIRED"
  | "ENFORCED_BY_EXECUTOR";

export type EvidenceSnapshot = {
  exportedAt: string;
  total: number;
  settledSuccess: number;
  settledFallback: number;
  recovered: number;
  includesSimulationRecords: boolean;
};

export type ServiceReadiness = {
  status: "READ_ONLY_READY" | "OPERATOR_READY" | "CONFIGURATION_REQUIRED";
  deploymentMode: DeploymentMode;
  network: {
    name: "Coston2";
    chainId: 114;
  };
  capabilities: {
    livePreview: CapabilityState;
    onchainEvidence: CapabilityState;
    xamanSigning: CapabilityState;
    durableJobStore: CapabilityState;
    executorWorker: CapabilityState;
    fullCallSimulation: CapabilityState;
  };
  evidence?: EvidenceSnapshot;
  message: string;
};

export function buildServiceReadiness(input: {
  deploymentMode: DeploymentMode;
  xamanConfigured: boolean;
  evidence?: EvidenceSnapshot;
}): ServiceReadiness {
  const durable = input.deploymentMode === "durable-executor";
  const signingAvailable = durable && input.xamanConfigured;

  return {
    status: durable
      ? signingAvailable
        ? "OPERATOR_READY"
        : "CONFIGURATION_REQUIRED"
      : "READ_ONLY_READY",
    deploymentMode: input.deploymentMode,
    network: { name: "Coston2", chainId: 114 },
    capabilities: {
      livePreview: "AVAILABLE",
      onchainEvidence: "AVAILABLE",
      xamanSigning: signingAvailable ? "AVAILABLE" : "DISABLED",
      durableJobStore: durable ? "AVAILABLE" : "DISABLED",
      executorWorker: "EXTERNAL_PROCESS_REQUIRED",
      fullCallSimulation: "ENFORCED_BY_EXECUTOR",
    },
    ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
    message: durable
      ? signingAvailable
        ? "Xaman signing and durable job creation are available. Run the separate executor worker to advance jobs."
        : "Configure Xaman credentials before creating durable signing requests. The executor worker remains a separate process."
      : "This public deployment provides live read-only previews and recorded on-chain evidence. Signing requires the durable local operator stack.",
  };
}
