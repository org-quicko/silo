import { Globe, Lock, Route as RouteIcon, TriangleAlert } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import type { PluginView } from '../../api/types/plugin-view'
import styles from './PluginDetail.module.css'

/**
 * What a plugin serves under `/api/ext/{name}/*`, and what reaching it means
 * (D36, phase 6).
 *
 * Immediately below the grant, because it is the grant's detail rather than a
 * property of the package. `http:route` is **one** claim covering every route a
 * manifest declares, so the tick box on its own says nothing about what is
 * exposed — this list is where that decision has any content, which is the same
 * argument D40 made for leading with hook delivery.
 *
 * A `public` route is called out because it is the one thing an operator cannot
 * infer: a handler runs with the **plugin's** authority, not the caller's, so a
 * public route publishes whatever the plugin was granted at a URL anyone can
 * reach. That is the confused-deputy hazard, and it is worth saying in the place
 * where somebody is deciding.
 */
export function PluginRoutesCard({ plugin }: { plugin: PluginView }) {
  const routes = plugin.routes ?? []
  if (routes.length === 0) return null

  const serving = Claims.has(plugin.effective, Claims.HttpRoute)
  const publicRoutes = routes.filter((route) => route.auth === 'public')

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.sectionTitle}>
          <RouteIcon size={15} />
          <h2>Routes</h2>
        </div>
        <p>
          {serving ? (
            <>
              Served at <code>/api/ext/{plugin.name}/…</code>. A handler runs with{' '}
              <b>this plugin’s</b> authority and not the caller’s, so reaching one of these is
              reaching whatever the plugin is granted above.
            </>
          ) : (
            <>
              Declared, and not served: the plugin does not hold{' '}
              <code>{Claims.HttpRoute}</code>, so every one of these answers 403. Approve that claim
              above to open them.
            </>
          )}
        </p>
      </div>

      {serving && publicRoutes.length > 0 && (
        <div className={styles.note}>
          <b>
            <TriangleAlert size={13} /> {publicRoutes.length} of these need no credential at all.
          </b>
          <span>
            Anyone who can reach this server can call{' '}
            {publicRoutes.map((route) => `${route.method} ${route.path}`).join(', ')} — and whatever
            the handler does, it does with the plugin’s grant.
          </span>
        </div>
      )}

      <div className={styles.claimList}>
        {routes.map((route) => (
          <div className={styles.claimRow} key={`${route.method} ${route.path}`}>
            <div className={styles.claimBody}>
              <span className={styles.claimText}>
                {route.method} /api/ext/{plugin.name}
                {route.path === '/' ? '' : route.path}
              </span>
              <span className={styles.claimPhrase}>
                {route.auth === 'public' ? (
                  <span className={styles.claimFlag}>
                    <Globe size={12} /> public — no key required
                  </span>
                ) : (
                  <span className={styles.claimBlockedWhy}>
                    <Lock size={12} /> any authenticated key
                  </span>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
