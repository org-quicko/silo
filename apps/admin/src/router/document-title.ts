import type { Route, SettingsRoute } from './route'

/**
 * What the browser tab is called, for one route.
 *
 * Pure, and beside `Routes` rather than inside a view, for the reason the URL
 * grammar lives here: the title is a second rendering of the route, and a
 * rendering kept next to the thing it renders cannot drift from it. A view that
 * set its own title would also have to unset it, and two views mounting in the
 * wrong order would leave the wrong name in the tab.
 *
 * The shapes, all under one `silo` so a row of tabs sorts together:
 *
 *   silo - <server> - <project>/<env>
 *   silo - <server> - Media Library <folder>
 *   silo - <server> - Settings - <tab>
 */
export class DocumentTitle {
  /** Before a server is chosen there is nothing to name, so the tab keeps the
   *  name the document was served with. Spelled exactly as `index.html` spells
   *  it: this is written over the served title the moment the app mounts, so a
   *  second spelling here would make that file's `<title>` a flicker. */
  static readonly Gate = 'silo - admin'

  static of(route: Route | null, serverName: string | null): string {
    if (!route || route.view === 'servers' || !serverName) return DocumentTitle.Gate
    const prefix = `silo - ${serverName}`

    if (route.view === 'media') {
      return route.folder ? `${prefix} - Media Library ${route.folder}` : `${prefix} - Media Library`
    }
    if (route.view === 'trash') return `${prefix} - Trash`
    if (
      route.view === 'server-settings' ||
      route.view === 'project-settings' ||
      route.view === 'env-settings'
    ) {
      return `${prefix} - Settings - ${DocumentTitle.settingsTab(route)}`
    }
    return `${prefix} - ${route.project}/${route.env}`
  }

  /**
   * The settings nav's own wording for the page, which is what the reader has
   * just clicked. A scoped page carries its scope in front of it: the nav nests
   * General under a project and under an environment both, so the label alone
   * names two different pages.
   */
  private static settingsTab(route: SettingsRoute): string {
    if (route.view === 'project-settings') {
      return `${route.project} - ${route.section === 'general' ? 'General' : 'Environments'}`
    }
    if (route.view === 'env-settings') {
      const scope = `${route.project}/${route.env}`
      if (route.section === 'variables') return `${scope} - Variables`
      if (route.section === 'transfer') return `${scope} - Data Transfer`
      return `${scope} - General`
    }
    return DocumentTitle.ServerSections[route.section]
  }

  /** One entry per `ServerSettingsSection`, spelled as `SettingsNav` spells it.
   *  The pages addressed by an identifier take their list's name: a title is
   *  read at a glance, and a key id is not. */
  private static readonly ServerSections: Record<
    Extract<Route, { view: 'server-settings' }>['section'],
    string
  > = {
    keys: 'API Keys',
    'key-new': 'API Keys',
    'key-edit': 'API Keys',
    'ai-assistants': 'AI assistants',
    transfer: 'Data Transfer',
    'media-storage': 'Media Library',
    configuration: 'Configuration',
    plugins: 'Plugins',
    plugin: 'Plugins',
    connection: 'Connection',
    projects: 'Projects',
    appearance: 'Appearance',
  }
}
