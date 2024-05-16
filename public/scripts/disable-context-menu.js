;((document, window) => {
  if (!document || !window) {
    return
  }

  const isReleaseMode =
    document.currentScript.getAttribute('data-env') === 'production'

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
