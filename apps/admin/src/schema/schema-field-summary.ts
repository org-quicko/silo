import { SiloRef } from '@silo/shared/silo-ref'
import { SchemaConstraints } from './schema-constraints'
import { SchemaFieldLabels, type SchemaField } from './schema-field'

/** The one-line description shown beside a field in the visual builder. */
export class SchemaFieldSummary {
  /** Past this many, an enum leads with its size: the row is one line, and the
   *  count is the part a reader needs whether or not the values fit on it. */
  static readonly MaxListedEnumValues = 4

  /**
   * What the field is, then what it accepts. The two are joined rather than
   * chosen between, so a description never hides a constraint and a constraint
   * never costs the author their own words; the row clips at one line either
   * way and carries the whole text as its tooltip.
   */
  static describe(field: SchemaField): string {
    if (field.construct) return `${field.construct} · edit in Code view`
    return [SchemaFieldSummary.lead(field), SchemaFieldSummary.limits(field)]
      .filter(Boolean)
      .join(' · ')
  }

  /** What the type column shows — the construct wins, because the builder
   *  cannot draw it and says so. */
  static typeLabel(field: SchemaField): string {
    return field.construct || SchemaFieldLabels[field.kind]
  }

  private static lead(field: SchemaField): string {
    if (field.kind === 'ref' || field.kind === 'ref-array') {
      return SchemaFieldSummary.describeReference(field)
    }
    if (field.kind === 'enum' && field.enumValues.length) {
      const values = field.enumValues
      const size = values.length > SchemaFieldSummary.MaxListedEnumValues ? `${values.length} values · ` : ''
      return `Enum · ${size}${values.join(', ')}`
    }
    return field.description || SchemaFieldLabels[field.kind]
  }

  /** The field's constraints as the shortest phrase that still names each one. */
  private static limits(field: SchemaField): string {
    const constraints = field.constraints
    switch (SchemaConstraints.groupFor(field.kind)) {
      case 'text':
        return [
          constraints.format,
          SchemaFieldSummary.range(constraints.minLength, constraints.maxLength, 'chars'),
          constraints.pattern && 'pattern',
        ]
          .filter(Boolean)
          .join(' · ')
      case 'range':
        return [
          SchemaFieldSummary.range(constraints.minimum, constraints.maximum, ''),
          constraints.multipleOf && `step ${constraints.multipleOf}`,
        ]
          .filter(Boolean)
          .join(' · ')
      case 'items':
        return [
          SchemaFieldSummary.range(constraints.minItems, constraints.maxItems, 'items'),
          constraints.uniqueItems && 'no duplicates',
        ]
          .filter(Boolean)
          .join(' · ')
      default:
        return ''
    }
  }

  /** `3–80 chars` for both bounds, `min 3 chars` or `max 80 chars` for one,
   *  nothing for neither. */
  private static range(minimum: string, maximum: string, unit: string): string {
    if (minimum && maximum) return `${minimum}–${maximum}${SchemaFieldSummary.unit(unit, maximum)}`
    if (minimum) return `min ${minimum}${SchemaFieldSummary.unit(unit, minimum)}`
    if (maximum) return `max ${maximum}${SchemaFieldSummary.unit(unit, maximum)}`
    return ''
  }

  /** The unit after the count it measures, singular where that count is one:
   *  a list of exactly one is `1 item`, not `1 items`. */
  private static unit(unit: string, count: string): string {
    if (!unit) return ''
    return ` ${count === '1' ? unit.replace(/s$/, '') : unit}`
  }

  private static describeReference(field: SchemaField): string {
    const lead = field.kind === 'ref-array' ? 'List of' : 'References'

    if (SiloRef.isLocal(field.refTarget)) {
      return `${lead} collection · ${SiloRef.collectionOf(field.refTarget)}`
    }
    if (field.refTarget) return `${lead} remote schema · ${field.refTarget}`
    return `${field.kind === 'ref-array' ? 'Reference list' : 'Reference'} · no target yet`
  }
}
