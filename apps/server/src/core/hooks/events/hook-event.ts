import type { AfterDeleteEvent } from "./after-delete-event";
import type { AfterWriteEvent } from "./after-write-event";
import type { BeforeDeleteEvent } from "./before-delete-event";
import type { BeforeValidateEvent } from "./before-validate-event";
import type { BeforeWriteEvent } from "./before-write-event";
import type { CollectionDeletedEvent } from "./collection-deleted-event";

/** Any hook event, for code that dispatches without caring which. */
export type HookEvent =
  | BeforeValidateEvent
  | BeforeWriteEvent
  | AfterWriteEvent
  | BeforeDeleteEvent
  | AfterDeleteEvent
  | CollectionDeletedEvent;
