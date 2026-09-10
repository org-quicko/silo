import { describe, expect, test } from "bun:test";
import { InvalidResponseError } from "../../src/errors/invalid-response-error";
import { NetworkError } from "../../src/errors/network-error";
import { RequestAbortedError } from "../../src/errors/request-aborted-error";
import { SiloError } from "../../src/errors/silo-error";
import { TimeoutError } from "../../src/errors/timeout-error";

describe("Errors for a request that never got an answer", () => {
  test("none of the four extend SiloError, because nothing answered", () => {
    expect(new NetworkError("GET", "/api/health", new Error("boom"))).not.toBeInstanceOf(SiloError);
    expect(new TimeoutError("GET", "/api/health", 5000)).not.toBeInstanceOf(SiloError);
    expect(new RequestAbortedError("GET", "/api/health")).not.toBeInstanceOf(SiloError);
    expect(new InvalidResponseError("GET", "/api/health", "text/html")).not.toBeInstanceOf(SiloError);
  });

  test("each is still an Error, with a distinct name and working instanceof", () => {
    const network = new NetworkError("POST", "/api/projects", new Error("ECONNREFUSED"));
    expect(network).toBeInstanceOf(NetworkError);
    expect(network).toBeInstanceOf(Error);
    expect(network.name).toBe("NetworkError");
    expect(network.cause).toBeInstanceOf(Error);

    const timeout = new TimeoutError("GET", "/api/health", 30_000);
    expect(timeout).toBeInstanceOf(TimeoutError);
    expect(timeout.name).toBe("TimeoutError");
    expect(timeout.timeoutMilliseconds).toBe(30_000);

    const aborted = new RequestAbortedError("GET", "/api/health");
    expect(aborted).toBeInstanceOf(RequestAbortedError);
    expect(aborted.name).toBe("RequestAbortedError");

    const invalid = new InvalidResponseError("GET", "/api/health", "text/html");
    expect(invalid).toBeInstanceOf(InvalidResponseError);
    expect(invalid.name).toBe("InvalidResponseError");
    expect(invalid.contentType).toBe("text/html");
  });
});
