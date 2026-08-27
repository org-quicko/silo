/** Which write a hook is being told about (D31/§13.5). Carried on the event
 *  rather than split into separate hooks, which would double what 1.0 freezes
 *  for no expressive gain. */
export type HookOp = "create" | "update" | "delete";
