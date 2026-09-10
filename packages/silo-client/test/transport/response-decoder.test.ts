import { describe, expect, test } from "bun:test";
import { InvalidResponseError } from "../../src/errors/invalid-response-error";
import { ResponseDecoder } from "../../src/transport/response-decoder";
import { StubResponse } from "../support/stub-response";

const request = { method: "GET", path: "/api/health" };

describe("ResponseDecoder", () => {
  test("204 decodes to undefined", async () => {
    const result = await ResponseDecoder.decode(StubResponse.empty(), request, true);
    expect(result).toBeUndefined();
  });

  test("application/json decodes to parsed JSON", async () => {
    const result = await ResponseDecoder.decode(StubResponse.json({ status: "ok" }), request, true);
    expect(result).toEqual({ status: "ok" });
  });

  test("a non-JSON body decodes to text when JSON is not expected", async () => {
    const result = await ResponseDecoder.decode(StubResponse.text("hello"), request, false);
    expect(result).toBe("hello");
  });

  test("a non-JSON body raises InvalidResponseError when JSON was expected", async () => {
    const response = StubResponse.text("<html>bad gateway</html>", 200, "text/html");
    await expect(ResponseDecoder.decode(response, request, true)).rejects.toBeInstanceOf(InvalidResponseError);
  });

  test("InvalidResponseError carries the method, path and content type", async () => {
    const response = StubResponse.text("nope", 200, "text/plain");
    try {
      await ResponseDecoder.decode(response, request, true);
      throw new Error("expected a rejection");
    } catch (caught) {
      const error = caught as InvalidResponseError;
      expect(error.method).toBe("GET");
      expect(error.path).toBe("/api/health");
      expect(error.contentType).toContain("text/plain");
    }
  });
});
