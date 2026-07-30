import { resolve } from "node:path";
import {
  summarizeJobs,
  toPublicJob,
} from "../src/api/public-model.js";
import { ExecutorStateStore } from "../src/executor/state-store.js";

function json(value: unknown) {
  return JSON.stringify(
    value,
    (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    2,
  );
}

const jobArgument = process.argv.indexOf("--job");
const jobId =
  jobArgument === -1 ? undefined : process.argv[jobArgument + 1];
if (jobArgument !== -1 && jobId === undefined) {
  throw new Error("--job requires an executor job id");
}
const databasePath = resolve(
  process.cwd(),
  process.env.EXECUTOR_DB_PATH ?? "./data/mintshield.db",
);
const store = new ExecutorStateStore(databasePath);
try {
  const jobs = jobId === undefined ? store.listAll() : [store.require(jobId)];
  console.log(
    json({
      evidenceVersion: 2,
      exportedAt: new Date().toISOString(),
      chainId: 114,
      summary: summarizeJobs(jobs),
      jobs: jobs.map(toPublicJob),
    }),
  );
} finally {
  store.close();
}
