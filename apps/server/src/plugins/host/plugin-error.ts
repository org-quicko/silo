import { ValidationError } from "@silo/shared/validation-error";
import type { WireError } from "./wire-error";
import { ForbiddenError } from "../../core/errors/forbidden-error";
import { NotFoundError } from "../../core/errors/not-found-error";
import { ConflictError } from "../../core/errors/conflict-error";

/** An error flattened for `postMessage`. */
/**
 * Errors across the worker boundary (D31/§13.4, §13.9).
 *
 * A class does not survive structured clone — only its own enumerable data
 * does — so an error is carried as `{ name, message, details }` and rebuilt on
 * the far side by name. That is the same problem `ValidationError.is` exists to
 * solve one layer down, made explicit rather than worked around: identity
 * cannot cross a realm, so nothing here depends on it.
 *
 * Which errors are rebuilt is a **contract, not a convenience**. A hook that
 * throws `ValidationError` or `ForbiddenError` is *rejecting* the write and
 * must surface as 400/403; anything else is a plugin fault and stays a plain
 * `Error` so `HookBus` can apply `on_error` to it. Rebuilding an unknown class
 * as itself would quietly turn a crashing plugin into a rejected request.
 */
export class PluginError {
  static toWire(err: unknown): WireError {
    if (ValidationError.is(err)) {
      // The raw message, not `err.message`: the constructor appends details to
      // the message, so rehydrating with both would print them twice.
      return { name: "ValidationError", message: PluginError.bareMessage(err), details: err.details };
    }
    if (err instanceof Error) {
      return { name: err.name, message: err.message };
    }
    return { name: "Error", message: String(err) };
  }

  static fromWire(wire: WireError | undefined): Error {
    if (!wire) return new Error("plugin call failed with no error");

    switch (wire.name) {
      case "ValidationError":
        return new ValidationError(wire.message, wire.details ?? []);
      case "ForbiddenError":
        return new ForbiddenError(wire.message);
      case "NotFoundError":
        return new NotFoundError(wire.message);
      case "ConflictError":
        return new ConflictError(wire.message);
      default: {
        // Deliberately a plain Error: an unrecognised name is a plugin fault,
        // and dressing it as a domain error would let a crash masquerade as a
        // deliberate rejection.
        const err = new Error(wire.message);
        err.name = wire.name || "Error";
        return err;
      }
    }
  }

  /** The message as it was passed in, with the details suffix the
   *  `ValidationError` constructor added stripped back off. */
  private static bareMessage(err: ValidationError): string {
    if (err.details.length === 0) return err.message;
    const suffix = `: ${err.details.map((d) => `"${d.path}": ${d.message}`).join("; ")}`;
    return err.message.endsWith(suffix) ? err.message.slice(0, -suffix.length) : err.message;
  }
}
