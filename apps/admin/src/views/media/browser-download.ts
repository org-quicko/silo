/**
 * Hands a URL to the browser's own download list (D100): the response is an
 * `attachment`, so the page stays put and nothing is held in the tab.
 */
export class BrowserDownload {
  static start(url: string): void {
    const link = document.createElement('a')
    link.href = url
    link.download = ''
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }
}
