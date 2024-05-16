;((document, window) => {
  if (!document || !window) {
    return
  }

  const isReleaseMode = !(
    window.location.hostname === 'tauri.localhost' ||
    window.location.hostname === 'localhost'
  )

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
})(document, window)
