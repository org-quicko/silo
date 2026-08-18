export interface CopyFromServerOptions {
  sourceUrl: string
  sourceApiKey: string
  mode: 'merge' | 'replace'
  withKeys: boolean
  dryRun: boolean
  prefer?: '' | 'local' | 'remote'
}
