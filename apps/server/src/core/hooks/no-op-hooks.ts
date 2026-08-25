import type { Hooks } from "./hooks";
import type { BeforeValidateEvent } from "./events";

/**
 * What `SiloService` dispatches into when nothing is configured (D31).
 *
 * A null object rather than an optional field, so every dispatch site reads the
 * same whether or not plugins exist — the alternative is one `if (this.hooks)`
 * guard per dispatch site that each has to be got right, and one more that
 * somebody forgets. The
 * cost is five awaited no-ops per write, which is not measurable beside the
 * validation pass they sit next to.
 */
export class NoOpHooks implements Hooks {
  async beforeValidate(event: BeforeValidateEvent): Promise<any> {
    return event.data;
  }

  async beforeWrite(): Promise<void> {}

  async afterWrite(): Promise<void> {}

  async beforeDelete(): Promise<void> {}

  async afterDelete(): Promise<void> {}

  async afterCollectionDelete(): Promise<void> {}
}
