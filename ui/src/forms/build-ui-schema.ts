import { MediaField } from '@silo/shared/media-field'
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
    const unrenderable =
      p[SiloRefs.markerKey] || p.oneOf || p.anyOf || p.allOf || (p.type === 'object' && !p.properties && !p.additionalProperties)
    if (xui.widget === 'json' || unrenderable) {
      ui[key] = { 'ui:field': 'json' }
    } else if (p.type === 'array' && (p.items?.type === 'string' || !p.items?.type) && !p.items?.enum) {
      if (MediaField.is(p.items) || p.items?.['x-silo-ui']?.widget === 'media') {
        ui[key] = { items: { 'ui:widget': 'media' } }
      } else {
        ui[key] = { 'ui:widget': 'tags' }
      }
    } else if (p.type === 'string' && (p.format === 'markdown' || xui.widget === 'markdown' || xui.widget === 'textarea')) {
      ui[key] = { 'ui:widget': 'textarea' }
    } else if (
      MediaField.is(p) ||
      p['x-silo-media'] === true ||
      (p.type === 'string' && (p.format === 'uri' || xui.widget === 'media'))
    ) {
      ui[key] = { 'ui:widget': 'media' }
    } else if (p.type === 'object' && p.properties) {
      ui[key] = buildUiSchema(p, root)
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
