import { FileText, Folder, Image, Layers, Package } from 'lucide-react'
import type { TrashKind } from '../../api/types/trash-item'

/** The icon a trash item is drawn with, by what it stands for. */
export function TrashKindIcon({ kind, size = 14 }: { kind: TrashKind; size?: number }) {
  if (kind === 'project') return <Package size={size} />
  if (kind === 'environment') return <Layers size={size} />
  if (kind === 'collection') return <Layers size={size} />
  if (kind === 'media') return <Image size={size} />
  if (kind === 'media_folder') return <Folder size={size} />
  return <FileText size={size} />
}
