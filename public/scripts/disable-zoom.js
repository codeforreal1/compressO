;((document, window) => {
  if (!document || !window) {
    return
  }

  document.body.addEventListener(
    'wheel',
    (evt) => {
      if (evt.ctrlKey || evt.metaKey) {
        evt.preventDefault()
        evt.stopImmediatePropagation()
        return false
      }
    },
    { passive: false },
  )

  document.addEventListener(
    'touchmove',
    (evt) => {
      evt.preventDefault()
      evt.stopImmediatePropagation()
      return false
    },
    { passive: false },
  )

  window.addEventListener(
    'keydown',
    function (evt) {
      if (
        (evt.ctrlKey || evt.metaKey) &&
        (evt.key === '-' || evt.key === '=' || evt.key === '0')
      ) {
        evt.preventDefault()
        evt.stopImmediatePropagation()
        return false
      }
    },
    { passive: false },
  )

  document.addEventListener(
    'gesturestart',
    function (evt) {
      evt.preventDefault()
      return false
    },
    { passive: false },
  )

  document.addEventListener(
    'gesturechange',
    function (evt) {
      evt.preventDefault()
      return false
    },
    { passive: false },
  )
  document.addEventListener(
    'gestureend',
    function (evt) {
      evt.preventDefault()
      return false
    },
    { passive: false },
  )
})(document, window)
