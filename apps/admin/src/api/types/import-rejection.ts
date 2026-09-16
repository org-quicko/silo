/** One entry an import refused, and why. The server's `ImportRejection`. */
export interface ImportRejection {
  project: string
  env: string
  collection: string
  id: string
  reason: string
}
