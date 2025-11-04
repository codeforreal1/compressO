;(function (document, window) {
  if (!document || !window) {
    return
  }

  document.addEventListener('DOMContentLoaded', () => {
    var styleText =
      '::-moz-focus-inner{border:0 !important;}:focus{outline: none !important; -webkit-box-shadow: none; box-shadow: none;'
    var unfocusStyle = document.createElement('STYLE')

    window.unfocus = function () {
      let keypressCount = 0
      document.getElementsByTagName('HEAD')[0].appendChild(unfocusStyle)
      document.addEventListener('mouseover', function () {
        keypressCount = 0
        disableAccessibilityOutline()
      })
      document.addEventListener('keyup', function (evt) {
        if (keypressCount >= 1) {
          enableAccessibilityOutline()
        } else {
          keypressCount += 1
        }
      })
      window.addEventListener('blur', () => {
        keypressCount = 0
        disableAccessibilityOutline()
      })
      function disableAccessibilityOutline() {
        if (
          typeof unfocusStyle.innerHTML === 'string' &&
          unfocusStyle.innerHTML.length === 0
        ) {
          unfocusStyle.innerHTML = styleText + '}'
        }
      }
      function enableAccessibilityOutline() {
        unfocusStyle.innerHTML = ''
      }
    }

    unfocus.style = function (style) {
      styleText += style
    }

    unfocus()
  })
})(document, window)
