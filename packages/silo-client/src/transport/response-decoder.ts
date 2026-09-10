import { InvalidResponseError } from "../errors/invalid-response-error.js";

/**
 * Decodes a successful response by its content type: `204` to `undefined`,
 * `application/json` to parsed JSON, everything else to text.
 *
 * `expectJson` is true for a route documented to answer JSON — a body of any
 * other content type there raises `InvalidResponseError` rather than being
 * handed back as text nobody asked for.
 */
export class ResponseDecoder {
  static async decode(
    response: Response,
    request: { method: string; path: string },
    expectJson: boolean,
  ): Promise<unknown> {
    if (response.status === 204) return undefined;

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return response.json();
    }

    if (expectJson) {
      throw new InvalidResponseError(request.method, request.path, contentType);
    }

    return response.text();
  }
}
