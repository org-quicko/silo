import { ProviderPorts } from "../provider-ports";
import type { PortMethod } from "../provider-ports";
import type { ScaffoldOptions } from "../scaffold-options";

/**
 * The generated `index.ts` for a provider plugin (D31/§13.7).
 *
 * A provider is **constructed, not dispatched**: `PluginLoader.loadProviders`
 * reads `default.create` and registers it as the factory behind a driver name,
 * so the default export here is not a `defineSiloPlugin` descriptor and never
 * reaches the worker host at all. That difference is the one thing an author
 * arriving from the extension docs gets wrong, so the file says it before it
 * says anything else.
 *
 * Every parameter is annotated `any`, and every method throws. Both are the
 * honest state of a scaffolded provider: the domain types are unpublished
 * (§12.8, see `ProviderPorts`), and silo has ~20 `Storage` methods of which no
 * partial implementation is meaningfully "working" — so an unwritten one fails
 * loudly on first call rather than returning an empty list that reads as an
 * empty instance.
 */
export class ProviderModule {
  static render(options: ScaffoldOptions): string {
    const port = options.port!;
    const className = ProviderModule.className(options);
    const methods = ProviderPorts.for(port);

    return `${ProviderModule.header(options)}

export default {
  /**
   * Called once at startup, before any storage is opened — a provider *is* the
   * storage, so it is constructed ahead of everything that uses one.
   *
   * @param config  this plugin's \`[plugins.config]\`. The scaffold declares no
   *                \`silo.config\` schema, because what a driver needs — a
   *                bucket, an endpoint, a token — is yours to name: add one to
   *                \`package.json#silo.config\` as JSON Schema and silo will
   *                validate it at startup, refusing to start when it is wrong.
   * @param silo    ${ProviderModule.siloParamDoc(port)}
   */
  ${port === "storage" ? "async " : ""}create(config: any, silo: any) {
    return new ${className}(config, silo);
  },
};

/** ${ProviderModule.classDoc(port)} */
class ${className} {
  private readonly config: any;
  private readonly silo: any;

  constructor(config: any, silo: any) {
    this.config = config;
    this.silo = silo;
  }

${methods.map((method) => ProviderModule.method(method)).join("\n\n")}
}
`;
  }

  private static header(options: ScaffoldOptions): string {
    const port = options.port!;
    const section = port === "storage" ? "storage" : "blob_storage";

    return `// A silo **provider** plugin: it registers the ${port} driver
// "${options.driver}", which \`silo.toml\` then selects with
// \`[${section}] driver = "${options.driver}"\`.
//
// Providers run **in-process**, not in a Worker. Isolating something already
// trusted with every byte in the instance protects nothing, and the storage
// port is chatty enough to pay real clone cost per page (§13.4). The
// consequence is that a provider must not block: it holds the same event loop
// the HTTP server does.
//
// The port's real interface — with types — is \`${ProviderPorts.source(port)}\`
// in the silo repo. It is not published yet, so the parameters below are typed
// \`any\` and the checklist carries the invariants the signatures cannot.${
      port === "storage"
        ? `
//
// A third-party store is only credible if it is testable: run it against
// \`server/test/conformance/storage-conformance.ts\`, which pins what the types
// cannot — \`derived\` landing inside the write transaction, instance-global
// monotonic \`seq\`, and the two-halves rule for whether a scope exists.`
        : ""
    }
//
// \`silo:api\` is deliberately not imported: it carries the extension surface —
// hooks, \`ValidationError\`, \`defineSiloPlugin\` — none of which a provider uses.`;
  }

  private static siloParamDoc(port: string): string {
    return port === "storage"
      ? "silo's own resolved config (`silo.storage.path`, `silo.search`, …)."
      : "the resolved `[blob_storage]` config block.";
  }

  private static classDoc(port: string): string {
    return port === "storage"
      ? "Implements the `Storage` port. Every entry, schema and scope in the instance goes through here."
      : "Implements the `BlobStorage` port — the bytes behind uploaded media.";
  }

  /** `my-store` → `MyStore`. Derived from the driver name, because that is the
   *  name an operator types in `silo.toml` — so grepping for one finds the
   *  other. */
  private static className(options: ScaffoldOptions): string {
    const pascal = options
      .driver!.split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join("");
    const suffix = options.port === "storage" ? "Store" : "BlobStorage";
    const base = pascal.length > 0 ? pascal : "Custom";
    return base.endsWith(suffix) ? base : `${base}${suffix}`;
  }

  private static method(method: PortMethod): string {
    const doc = method.note ? `  /** ${method.note} */\n` : "";
    const params = method.params
      .split(",")
      .map((param) => param.trim())
      .filter(Boolean)
      .map((param) => `${param}: any`)
      .join(", ");

    return `${doc}  async ${method.name}(${params}): Promise<any> {
    throw new Error("${method.name}: not implemented");
  }`;
  }
}
