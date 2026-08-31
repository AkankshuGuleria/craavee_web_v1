/**
 * Maps a runner Edge Function error `code` (the canonical
 * `@craavee/api-contracts` catalogue) to a runner-facing message —
 * Phase 7 §17/§22.
 *
 * The client branches on `code`, never on `message` (API_CONTRACTS.md:
 * "do not rely on arbitrary human-readable strings as API contracts").
 * A raw Postgres string never reaches a screen.
 *
 * `losable` marks the errors that mean "someone else got there first" —
 * the queue should refresh and the runner should move on, rather than be
 * offered a retry that cannot succeed.
 */
import type { ErrorCode } from "@craavee/api-contracts";

export interface RunnerUiError {
  title: string;
  message: string;
  /** true -> the job is gone or unavailable; refresh the queue. */
  losable: boolean;
  /** true -> a plain retry may succeed. */
  retryable: boolean;
}

const MAP: Partial<Record<ErrorCode | "UNKNOWN", RunnerUiError>> = {
  JOB_ALREADY_CLAIMED: {
    title: "Job taken",
    message: "Another runner claimed this one first.",
    losable: true,
    retryable: false,
  },
  RUNNER_ALREADY_ASSIGNED: {
    title: "You already have a job",
    message: "Finish or release your current delivery first.",
    losable: true,
    retryable: false,
  },
  DELIVERY_CODE_INVALID: {
    title: "Wrong code",
    message: "That code doesn't match. Check with the customer and try again.",
    losable: false,
    retryable: true,
  },
  RATE_LIMITED: {
    title: "Too many attempts",
    message: "Too many wrong codes. Wait a few minutes, then try again.",
    losable: false,
    retryable: false,
  },
  INVALID_ORDER_TRANSITION: {
    title: "Out of date",
    message: "This order moved on. Refreshing.",
    losable: true,
    retryable: false,
  },
  FORBIDDEN: {
    title: "Not allowed",
    message: "This job isn't yours.",
    losable: true,
    retryable: false,
  },
  AUTH_REQUIRED: {
    title: "Session expired",
    message: "Please sign in again.",
    losable: false,
    retryable: false,
  },
  VALIDATION_FAILED: {
    title: "Check that",
    message: "That doesn't look right. Please try again.",
    losable: false,
    retryable: true,
  },
  SERVICE_UNAVAILABLE: {
    title: "Try again",
    message: "Something went wrong on our side. Please retry.",
    losable: false,
    retryable: true,
  },
};

const FALLBACK: RunnerUiError = {
  title: "Try again",
  message: "Something went wrong. Please retry.",
  losable: false,
  retryable: true,
};

export function toRunnerUiError(code: string | undefined): RunnerUiError {
  if (!code) return FALLBACK;
  return MAP[code as ErrorCode] ?? FALLBACK;
}
