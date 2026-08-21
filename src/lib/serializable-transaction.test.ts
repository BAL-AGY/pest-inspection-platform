import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  runSerializableTransaction,
  SERIALIZABLE_MAX_ATTEMPTS,
} from "./serializable-transaction";

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("test conflict", {
    code,
    clientVersion: "test",
  });
}

describe("runSerializableTransaction", () => {
  it("retries P2034 and reruns the complete callback", async () => {
    const operation = vi.fn(async () => "committed");
    const execute = vi
      .fn()
      .mockRejectedValueOnce(prismaError("P2034"))
      .mockImplementationOnce(operation);
    const wait = vi.fn(async () => undefined);

    await expect(
      runSerializableTransaction(operation, { execute, wait }),
    ).resolves.toBe("committed");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("stops after the bounded number of serialization attempts", async () => {
    const conflict = prismaError("P2034");
    const execute = vi.fn().mockRejectedValue(conflict);

    await expect(
      runSerializableTransaction(async () => "never", {
        execute,
        wait: async () => undefined,
      }),
    ).rejects.toBe(conflict);
    expect(execute).toHaveBeenCalledTimes(SERIALIZABLE_MAX_ATTEMPTS);
  });

  it("does not retry uniqueness or business failures", async () => {
    const uniqueness = prismaError("P2002");
    const execute = vi.fn().mockRejectedValue(uniqueness);

    await expect(
      runSerializableTransaction(async () => "never", { execute }),
    ).rejects.toBe(uniqueness);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
