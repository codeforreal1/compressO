;((document, window) => {
  if (!document || !window) {
    return
  }

  window.addEventListener(
    'keydown',
    function (evt) {
      if (
        (evt.ctrlKey || evt.metaKey) &&
        (evt.key === 'r' ||
          evt.key === 'R' ||
          (evt.shiftKey && (evt.key === 'r' || evt.key === 'R')))
      ) {
        evt.preventDefault()
        evt.stopImmediatePropagation()
        return false
      }
    },
    { passive: false },
  )
})(document, window)
