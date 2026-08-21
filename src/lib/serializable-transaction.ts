import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export const SERIALIZABLE_MAX_ATTEMPTS = 3;

type TransactionOperation<T> = (tx: Prisma.TransactionClient) => Promise<T>;
type TransactionExecutor = <T>(operation: TransactionOperation<T>) => Promise<T>;

interface SerializableRetryOptions {
  maxAttempts?: number;
  execute?: TransactionExecutor;
  wait?: (milliseconds: number) => Promise<void>;
}

export function isSerializationConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034"
  );
}

/**
 * Runs a PostgreSQL serializable transaction with a small bounded retry.
 * Only genuine serialization/deadlock conflicts (Prisma P2034) are retried;
 * business validation, uniqueness errors, and persistent database failures
 * escape immediately. Re-running the complete callback is essential: every
 * retry must re-read authoritative capacity before attempting its write.
 */
export async function runSerializableTransaction<T>(
  operation: TransactionOperation<T>,
  options: SerializableRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? SERIALIZABLE_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("maxAttempts must be a positive integer");
  }

  const execute: TransactionExecutor =
    options.execute ??
    ((callback) =>
      prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      }));
  const wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await execute(operation);
    } catch (error) {
      if (!isSerializationConflict(error) || attempt === maxAttempts) throw error;
      // Short bounded jitter reduces immediate repeat collisions without
      // turning database contention into an unbounded request.
      await wait(attempt * 10 + Math.floor(Math.random() * 10));
    }
  }

  throw new Error("Serializable transaction exhausted attempts");
}
