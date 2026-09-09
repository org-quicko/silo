import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { Button } from '../buttons/Button'
import styles from './ErrorBoundary.module.css'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * The last thing between a render error and a blank page.
 *
 * Without one, a single throw anywhere in the tree unmounts the whole app and
 * leaves the operator looking at an empty document with nothing to act on and
 * no way back but a reload. That is not hypothetical: two copies of
 * `@codemirror/state` in one bundle made the schema editor's Code tab throw on
 * mount, and what the operator saw was the screen going white.
 *
 * It shows what broke and offers the two recoveries in order of cost. **Try
 * again** remounts the subtree by changing its key, which is enough whenever
 * the throw came from state the reader can leave — a tab they can switch away
 * from. **Reload** is the one that always works.
 *
 * A class because that is still the only way to catch a render error in React.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  /** Bumped by "Try again", so the subtree remounts rather than re-throwing
   *  from the state that broke it. */
  private attempt = 0

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The stack is the only record of this: there is no server to report to,
    // and the boundary is about to replace the tree that would have shown it.
    console.error('silo admin: render failed', error, info.componentStack)
  }

  private retry = () => {
    this.attempt++
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return <div key={this.attempt}>{this.props.children}</div>

    return (
      <div className={styles.boundary} role="alert">
        <AlertCircle size={22} className={styles.icon} />
        <h1 className={styles.title}>Something in the admin failed to render</h1>
        <p className={styles.detail}>{error.message || String(error)}</p>
        <div className={styles.actions}>
          <Button variant="primary" onClick={this.retry}>
            Try again
          </Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    )
  }
}
