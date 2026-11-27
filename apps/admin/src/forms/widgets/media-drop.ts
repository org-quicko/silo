/**
 * Single-file drag-and-drop and clipboard paste extraction for `MediaWidget`.
 *
 * Keeps upload permission checks, file-vs-text discrimination, and child
 * boundary tracking pure so they are testable without DOM mounts.
 */
export class MediaDrop {
  static canAcceptDrag(
    dataTransfer: Pick<DataTransfer, 'files' | 'types'> | null | undefined,
    enabled: boolean,
  ): boolean {
    if (!enabled || !dataTransfer) return false
    if ((dataTransfer.files?.length ?? 0) > 0) return true
    return Array.from(dataTransfer.types ?? []).includes('Files')
  }

  static droppedFile(
    dataTransfer: Pick<DataTransfer, 'files'> | null | undefined,
    enabled: boolean,
  ): File | null {
    if (!enabled || !dataTransfer?.files?.length) return null
    return dataTransfer.files[0] ?? null
  }

  static pastedFile(
    clipboardData: Pick<DataTransfer, 'files'> | null | undefined,
    enabled: boolean,
  ): File | null {
    if (!enabled || !clipboardData?.files?.length) return null
    return clipboardData.files[0] ?? null
  }

  /**
   * Returns true only when `relatedTarget` lies outside the drop container,
   * preventing drag highlight flicker as the pointer crosses child elements.
   */
  static leftTarget(containsTarget: (target: unknown) => boolean, relatedTarget: unknown): boolean {
    if (!relatedTarget) return true
    return !containsTarget(relatedTarget)
  }
}
