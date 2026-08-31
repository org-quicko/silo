import type { ConfigSettingsView } from '../types/settings'
import type { HttpTransport } from '../transport/http-transport'

/**
 * The rest of `silo.toml` (D47), behind `settings:configure`.
 *
 * One read for every section and one write per section, which mirrors the page:
 * the cards are drawn together, and drawing them from four requests is four
 * ways for the page to come up half-formed. Saving is per table, because a
 * rejected search setting must not stop a log level being fixed.
 */
export class SettingsApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  read(url: string, key: string): Promise<ConfigSettingsView> {
    return this.transport.request<ConfigSettingsView>(url, key, SettingsApi.Path)
  }

  /** Save one table. Answers with the whole view, since a save can change what
   *  another section reports. */
  saveSection(
    url: string,
    key: string,
    table: string,
    input: Record<string, unknown>,
  ): Promise<ConfigSettingsView> {
    return this.transport.request<ConfigSettingsView>(
      url,
      key,
      `${SettingsApi.Path}/${encodeURIComponent(table)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    )
  }

  private static readonly Path = '/api/settings'
}
