;((document, window) => {
  if (!document || !window) {
    return
  }

  document.addEventListener('DOMContentLoaded', () => {
    const isReleaseMode = window.__envMode === 'production'
    if (isReleaseMode) {
      document.addEventListener(
        'contextmenu',
        (e) => {
          e.preventDefault()
          return false
        },
        { capture: true },
      )

      document.addEventListener(
        'selectstart',
        (e) => {
          e.preventDefault()
          return false
        },
        { capture: true },
      )
    }
  })
})(document, window)
