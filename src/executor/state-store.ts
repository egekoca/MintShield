import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Hex } from "viem";

export const JOB_STATUSES = [
  "CREATED",
  "XRPL_SIGNED",
  "XRPL_FINALIZED",
  "FDC_REQUESTED",
  "PROOF_READY",
  "FLARE_SUBMITTED",
  "DELAYED",
  "SETTLED_SUCCESS",
  "SETTLED_FALLBACK",
  "RECOVERY_REQUIRED",
  "RECOVERY_PAYMENT_SIGNED",
  "RECOVERY_PAYMENT_FINALIZED",
  "RECOVERY_FDC_REQUESTED",
  "RECOVERY_PROOF_READY",
  "RECOVERY_FLAG_SUBMITTED",
  "RECOVERY_FLAG_SET",
  "RECOVERY_STUCK_SUBMITTED",
  "RECOVERED",
  "FAILED",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export type ExecutorJob = {
  id: string;
  intentKey: string;
  status: JobStatus;
  userOpHash: Hex;
  userOpData: Hex;
  xrplTxHash?: Hex;
  fdcRequest?: Hex;
  votingRound?: number;
  flareTxHash?: Hex;
  executionAllowedAt?: bigint;
  lastError?: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export type CreateJobInput = Pick<
  ExecutorJob,
  "intentKey" | "userOpHash" | "userOpData"
> & {
  id?: string;
  metadata?: Record<string, unknown>;
};

export type JobPatch = Partial<
  Pick<
    ExecutorJob,
    | "xrplTxHash"
    | "fdcRequest"
    | "votingRound"
    | "flareTxHash"
    | "executionAllowedAt"
    | "lastError"
    | "metadata"
  >
>;

const transitions: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  CREATED: ["XRPL_SIGNED", "FAILED"],
  XRPL_SIGNED: ["XRPL_FINALIZED", "FAILED"],
  XRPL_FINALIZED: ["FDC_REQUESTED", "FAILED"],
  FDC_REQUESTED: ["PROOF_READY", "FAILED"],
  PROOF_READY: ["FLARE_SUBMITTED", "FAILED"],
  FLARE_SUBMITTED: [
    "DELAYED",
    "SETTLED_SUCCESS",
    "SETTLED_FALLBACK",
    "RECOVERY_REQUIRED",
    "FAILED",
  ],
  DELAYED: [
    "FLARE_SUBMITTED",
    "SETTLED_SUCCESS",
    "SETTLED_FALLBACK",
    "RECOVERY_REQUIRED",
    "FAILED",
  ],
  SETTLED_SUCCESS: [],
  SETTLED_FALLBACK: [],
  RECOVERY_REQUIRED: [
    "FLARE_SUBMITTED",
    "DELAYED",
    "RECOVERY_PAYMENT_SIGNED",
    "FAILED",
  ],
  RECOVERY_PAYMENT_SIGNED: ["RECOVERY_PAYMENT_FINALIZED", "FAILED"],
  RECOVERY_PAYMENT_FINALIZED: ["RECOVERY_FDC_REQUESTED", "FAILED"],
  RECOVERY_FDC_REQUESTED: ["RECOVERY_PROOF_READY", "FAILED"],
  RECOVERY_PROOF_READY: ["RECOVERY_FLAG_SUBMITTED", "FAILED"],
  RECOVERY_FLAG_SUBMITTED: ["RECOVERY_FLAG_SET", "FAILED"],
  RECOVERY_FLAG_SET: ["RECOVERY_STUCK_SUBMITTED", "FAILED"],
  RECOVERY_STUCK_SUBMITTED: ["RECOVERED", "FAILED"],
  RECOVERED: [],
  FAILED: [],
};

type JobRow = {
  id: string;
  intent_key: string;
  status: string;
  user_op_hash: string;
  user_op_data: string;
  xrpl_tx_hash: string | null;
  fdc_request: string | null;
  voting_round: number | null;
  flare_tx_hash: string | null;
  execution_allowed_at: string | null;
  last_error: string | null;
  metadata_json: string;
  created_at: number;
  updated_at: number;
};

function parseMetadata(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Corrupt executor metadata: expected a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function toJob(row: JobRow): ExecutorJob {
  const job: ExecutorJob = {
    id: row.id,
    intentKey: row.intent_key,
    status: row.status as JobStatus,
    userOpHash: row.user_op_hash as Hex,
    userOpData: row.user_op_data as Hex,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.xrpl_tx_hash !== null) job.xrplTxHash = row.xrpl_tx_hash as Hex;
  if (row.fdc_request !== null) job.fdcRequest = row.fdc_request as Hex;
  if (row.voting_round !== null) job.votingRound = row.voting_round;
  if (row.flare_tx_hash !== null) job.flareTxHash = row.flare_tx_hash as Hex;
  if (row.execution_allowed_at !== null) {
    job.executionAllowedAt = BigInt(row.execution_allowed_at);
  }
  if (row.last_error !== null) job.lastError = row.last_error;
  return job;
}

function serializeMetadata(value: Record<string, unknown>) {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

export class ExecutorStateStore {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    this.#database = new DatabaseSync(path);
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS executor_jobs (
        id TEXT PRIMARY KEY,
        intent_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        user_op_hash TEXT NOT NULL,
        user_op_data TEXT NOT NULL,
        xrpl_tx_hash TEXT UNIQUE,
        fdc_request TEXT,
        voting_round INTEGER,
        flare_tx_hash TEXT,
        execution_allowed_at TEXT,
        last_error TEXT,
        metadata_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT
    `);
    this.#database.exec(`
      CREATE INDEX IF NOT EXISTS executor_jobs_status_updated
      ON executor_jobs(status, updated_at)
    `);
  }

  close() {
    this.#database.close();
  }

  createOrGet(input: CreateJobInput): {
    job: ExecutorJob;
    created: boolean;
  } {
    const existing = this.getByIntentKey(input.intentKey);
    if (existing !== undefined) {
      if (
        existing.userOpHash.toLowerCase() !== input.userOpHash.toLowerCase() ||
        existing.userOpData.toLowerCase() !== input.userOpData.toLowerCase()
      ) {
        throw new Error(
          `Intent key ${input.intentKey} is already bound to different user-op data`,
        );
      }
      return { job: existing, created: false };
    }

    const now = Date.now();
    const id = input.id ?? randomUUID();
    this.#database
      .prepare(`
        INSERT INTO executor_jobs (
          id, intent_key, status, user_op_hash, user_op_data, metadata_json,
          created_at, updated_at
        ) VALUES (?, ?, 'CREATED', ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.intentKey,
        input.userOpHash,
        input.userOpData,
        serializeMetadata(input.metadata ?? {}),
        now,
        now,
      );
    return { job: this.require(id), created: true };
  }

  get(id: string): ExecutorJob | undefined {
    const row = this.#database
      .prepare("SELECT * FROM executor_jobs WHERE id = ?")
      .get(id) as JobRow | undefined;
    return row === undefined ? undefined : toJob(row);
  }

  require(id: string): ExecutorJob {
    const job = this.get(id);
    if (job === undefined) throw new Error(`Executor job not found: ${id}`);
    return job;
  }

  getByIntentKey(intentKey: string): ExecutorJob | undefined {
    const row = this.#database
      .prepare("SELECT * FROM executor_jobs WHERE intent_key = ?")
      .get(intentKey) as JobRow | undefined;
    return row === undefined ? undefined : toJob(row);
  }

  getByXrplTxHash(xrplTxHash: Hex): ExecutorJob | undefined {
    const row = this.#database
      .prepare(
        "SELECT * FROM executor_jobs WHERE lower(xrpl_tx_hash) = lower(?)",
      )
      .get(xrplTxHash) as JobRow | undefined;
    return row === undefined ? undefined : toJob(row);
  }

  listAll(): ExecutorJob[] {
    const rows = this.#database
      .prepare("SELECT * FROM executor_jobs ORDER BY created_at ASC")
      .all() as unknown as JobRow[];
    return rows.map(toJob);
  }

  listRunnable(nowSeconds: bigint): ExecutorJob[] {
    const rows = this.#database
      .prepare(`
        SELECT * FROM executor_jobs
        WHERE status NOT IN (
          'SETTLED_SUCCESS', 'SETTLED_FALLBACK', 'RECOVERED', 'FAILED'
        )
          AND (
            status != 'DELAYED'
            OR CAST(execution_allowed_at AS INTEGER) <= ?
          )
        ORDER BY updated_at ASC
      `)
      .all(nowSeconds.toString()) as unknown as JobRow[];
    return rows.map(toJob);
  }

  transition(id: string, nextStatus: JobStatus, patch: JobPatch = {}) {
    const current = this.require(id);
    if (current.status !== nextStatus) {
      const allowed = transitions[current.status];
      if (!allowed.includes(nextStatus)) {
        throw new Error(
          `Invalid executor transition ${current.status} -> ${nextStatus}`,
        );
      }
    }

    const mergedMetadata =
      patch.metadata === undefined
        ? current.metadata
        : { ...current.metadata, ...patch.metadata };
    const updatedAt = Date.now();
    this.#database
      .prepare(`
        UPDATE executor_jobs SET
          status = ?,
          xrpl_tx_hash = ?,
          fdc_request = ?,
          voting_round = ?,
          flare_tx_hash = ?,
          execution_allowed_at = ?,
          last_error = ?,
          metadata_json = ?,
          updated_at = ?
        WHERE id = ?
      `)
      .run(
        nextStatus,
        patch.xrplTxHash ?? current.xrplTxHash ?? null,
        patch.fdcRequest ?? current.fdcRequest ?? null,
        patch.votingRound ?? current.votingRound ?? null,
        patch.flareTxHash ?? current.flareTxHash ?? null,
        (patch.executionAllowedAt ?? current.executionAllowedAt)?.toString() ??
          null,
        patch.lastError ?? current.lastError ?? null,
        serializeMetadata(mergedMetadata),
        updatedAt,
        id,
      );
    return this.require(id);
  }

  releaseRecoveredIntentKey(id: string) {
    const current = this.require(id);
    if (current.status !== "RECOVERED") {
      throw new Error(
        `Intent key can only be released after recovery, got ${current.status}`,
      );
    }
    const suffix = `:recovered:${id}`;
    if (current.intentKey.endsWith(suffix)) return current;
    const archivedIntentKey = `${current.intentKey}${suffix}`;
    const metadata = {
      ...current.metadata,
      originalIntentKey: current.intentKey,
    };
    this.#database
      .prepare(`
        UPDATE executor_jobs
        SET intent_key = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        archivedIntentKey,
        serializeMetadata(metadata),
        Date.now(),
        id,
      );
    return this.require(id);
  }
}
