// @ts-check
((document, window) => {
  if (!document || !window) {
    return;
  }

  document.body.addEventListener(
    "wheel",
    (evt) => {
      evt.preventDefault();
      evt.stopImmediatePropagation();
      return false;
    },
    { passive: false }
  );

  window.addEventListener(
    "keydown",
    function (evt) {
      if (
        ((evt.ctrlKey || evt.metaKey) &&
          // Zoom
          (evt.key === "-" || evt.key === "=" || evt.key === "0")) ||
        // Reload
        evt.key === "r" ||
        evt.key === "R" ||
        (evt.shiftKey && (evt.key === "r" || evt.key === "R"))
      ) {
        evt.preventDefault();
        evt.stopImmediatePropagation();
        return false;
      }
    },
    { passive: false }
  );

  document.addEventListener(
    "touchmove",
    (evt) => {
      evt.preventDefault();
      evt.stopImmediatePropagation();
      return false;
    },
    { passive: false }
  );

  document.addEventListener(
    "gesturestart",
    function (evt) {
      evt.preventDefault();
      return false;
    },
    { passive: false }
  );

  document.addEventListener(
    "gesturechange",
    function (evt) {
      evt.preventDefault();
      return false;
    },
    { passive: false }
  );
  document.addEventListener(
    "gestureend",
    function (evt) {
      evt.preventDefault();
      return false;
    },
    { passive: false }
  );
})(document, window);
