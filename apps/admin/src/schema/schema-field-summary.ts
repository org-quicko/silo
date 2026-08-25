import { SiloRef } from '@silo/shared/silo-ref'
import { SchemaFieldLabels, type SchemaField } from './schema-field'

/** The one-line description shown beside a field in the visual builder. */
export class SchemaFieldSummary {
  static describe(field: SchemaField): string {
    if (field.construct) return `${field.construct} · edit in Code view`
    if (field.kind === 'ref' || field.kind === 'ref-array') {
      return SchemaFieldSummary.describeReference(field)
    }
    if (field.kind === 'enum' && field.enumValues.length) {
      return `Enum · ${field.enumValues.join(', ')}`
    }
    return field.description || SchemaFieldLabels[field.kind]
  }

  /** What the type column shows — the construct wins, because the builder
   *  cannot draw it and says so. */
  static typeLabel(field: SchemaField): string {
    return field.construct || SchemaFieldLabels[field.kind]
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
