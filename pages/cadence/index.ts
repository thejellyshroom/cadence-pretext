/**
 * Cadence entry: analytics always; demo runtime only when the viewport is wide enough
 * (matches the desktop gate in `pages/index.html`).
 */
import '../analytics.ts'

/** Keep in sync with `@media (min-width: …)` for `.cadence-desktop-gate` in `index.html`. */
export const CADENCE_DESKTOP_MIN_WIDTH_PX = 1024

const desktopMql = window.matchMedia(`(min-width: ${CADENCE_DESKTOP_MIN_WIDTH_PX}px)`)

let cadenceAppLoaded = false

function loadCadenceApp(): void {
  if (!desktopMql.matches || cadenceAppLoaded) return
  cadenceAppLoaded = true
  void import('./cadence-app.ts')
}

loadCadenceApp()
desktopMql.addEventListener('change', loadCadenceApp)
