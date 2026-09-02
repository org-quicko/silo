import { MediaField } from '@silo/shared/media-field'
import { SchemaType } from '../schema/schema-type'
import { SiloRefs } from '../schema/silo-refs'

// derefLocal follows an internal `#/...` pointer within the resolved root
// schema (SiloRefs rewrites collection refs to such pointers). Returns null
// when the pointer doesn't resolve.
function derefLocal(ref: string, root: any): any {
  let cur = root
  for (const raw of ref.slice(1).split('/').slice(1)) {
    if (!cur || typeof cur !== 'object') return null
    cur = cur[raw.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  return cur ?? null
}

// buildUiSchema selects widgets for constructs RJSF wouldn't style the way the
// design wants: string arrays → chips, markdown strings → mini editor, and
// unrenderable subtrees (oneOf/anyOf/free object/unresolved refs) → raw-JSON
// fallback. Pass a SiloRefs-resolved schema: `$ref` properties are dereferenced
// against `root` so widget selection applies inside referenced collections too.
//
// Types are read through SchemaType, never off `type` directly: the keyword is
// a string *or* an array of them, and `["object", "null"]` is what every
// imported Strapi component is. Comparing against `'object'` therefore stopped
// the walk at the first nested component — the fields inside one got no widget
// at all, so a media field two levels down rendered as a text box holding a
// `silo://` reference. Array items are walked for the same reason: a repeatable
// component is an array of objects, which nothing here used to descend into.
export function buildUiSchema(schema: any, root: any = schema): any {
  if (!schema || typeof schema !== 'object') return {}
  const ui: any = {}
  const props = schema.properties || {}
  for (const key of Object.keys(props)) {
    let p = props[key]
    if (!p || typeof p !== 'object') continue
    if (typeof p.$ref === 'string') {
      const target = p.$ref.startsWith('#') ? derefLocal(p.$ref, root) : null
      if (!target || typeof target !== 'object') {
        ui[key] = { 'ui:field': 'json' }
        continue
      }
      p = target
    }
    const xui = p['x-silo-ui'] || {}
    const type = SchemaType.of(p)
    const unrenderable =
      p[SiloRefs.markerKey] || p.oneOf || p.anyOf || p.allOf || (type === 'object' && !p.properties && !p.additionalProperties)
    if (xui.widget === 'json' || unrenderable) {
      ui[key] = { 'ui:field': 'json' }
    } else if (type === 'array' && (typeof p.items?.$ref === 'string' || p.items?.[SiloRefs.markerKey])) {
      // Array of referenced collection entries: let RJSF's ArrayField render
      // each item through the referenced schema (SiloRefs has already
      // rewritten items.$ref to an internal #/$defs/... pointer). A marker
      // means the ref didn't resolve (remote/missing/cycle), so each item
      // falls back to the raw-JSON field. When the ref did resolve, recurse
      // into the target so widget selection applies inside referenced
      // collections too (e.g. a media field inside a referenced schema).
      if (p.items?.[SiloRefs.markerKey]) {
        ui[key] = { items: { 'ui:field': 'json' } }
      } else {
        const itemTarget = p.items.$ref.startsWith('#') ? derefLocal(p.items.$ref, root) : null
        if (itemTarget && typeof itemTarget === 'object') {
          const itemUi = buildUiSchema(itemTarget, root)
          if (Object.keys(itemUi).length > 0) ui[key] = { items: itemUi }
        }
      }
    } else if (type === 'array' && SchemaType.of(p.items) === 'object' && p.items.properties) {
      // A repeatable component: every item is drawn by the same schema, so its
      // fields choose their widgets once and RJSF applies them to each.
      const itemUi = buildUiSchema(p.items, root)
      if (Object.keys(itemUi).length > 0) ui[key] = { items: itemUi }
    } else if (type === 'array' && (SchemaType.of(p.items) === 'string' || SchemaType.isUntyped(p.items)) && !p.items?.enum && !p.items?.$ref && !p.items?.[SiloRefs.markerKey]) {
      if (MediaField.is(p.items) || p.items?.['x-silo-ui']?.widget === 'media') {
        ui[key] = { items: { 'ui:widget': 'media' } }
      } else {
        ui[key] = { 'ui:widget': 'tags' }
      }
    } else if (type === 'string' && (p.format === 'markdown' || xui.widget === 'markdown' || xui.widget === 'textarea')) {
      ui[key] = { 'ui:widget': 'textarea' }
    } else if (
      MediaField.is(p) ||
      p['x-silo-media'] === true ||
      (type === 'string' && (p.format === 'uri' || xui.widget === 'media'))
    ) {
      ui[key] = { 'ui:widget': 'media' }
    } else if (type === 'object' && p.properties) {
      const nested = buildUiSchema(p, root)
      if (Object.keys(nested).length > 0) ui[key] = nested
    }
    if (xui.order != null) {
      // preserved but not consumed here; RJSF ui:order would need array form
    }
  }
  if (Array.isArray(schema['x-silo-ui']?.order)) {
    ui['ui:order'] = schema['x-silo-ui'].order
  }
  return ui
}
