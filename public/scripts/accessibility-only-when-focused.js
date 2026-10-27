// Focus outlines (accessibility highlights) are only shown when navigating with the keyboard, like
// in native apps: hidden from the start (e.g. when the menu bar popover opens with a button
// focused), shown once Tab is pressed, and hidden again on the next click. Arrow keys don't show
// them, since they also seek videos.
;(function (document, window) {
  if (!document || !window) {
    return
  }

  var hideOutlinesStyle =
    '::-moz-focus-inner{border:0 !important;}' +
    ':focus{outline: none !important; -webkit-box-shadow: none; box-shadow: none;}'

  var style = document.createElement('style')
  // Hidden right away, before anything can be focused
  style.textContent = hideOutlinesStyle
  document.head.appendChild(style)

  function showOutlines() {
    style.textContent = ''
  }

  function hideOutlines() {
    style.textContent = hideOutlinesStyle
  }

  document.addEventListener(
    'keydown',
    function (evt) {
      if (evt.key === 'Tab') {
        showOutlines()
      }
    },
    true,
  )
  document.addEventListener('pointerdown', hideOutlines, true)
  window.addEventListener('blur', hideOutlines)
})(document, window)
