import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

/** The file types shown in turn */
const ITEMS = [
  "video",
  "mp4",
  "png",
  "mov",
  "jpg",
  "mp3",
  "mkv",
  "webp",
  "gif",
  "image",
  "audio",
];

const INTERVAL = 2400;
const SPRING = { type: "spring", stiffness: 260, damping: 30 } as const;

/**
 * The headline's last word, as a selected layer in a design tool: a thin frame with handles at its
 * corners, resizing smoothly to each new word.
 */
function SelectionWord() {
  const [index, setIndex] = useState(0);
  const reduceMotion = useReducedMotion();
  const word = ITEMS[index];

  useEffect(() => {
    if (reduceMotion) return;
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % ITEMS.length),
      INTERVAL,
    );
    return () => clearInterval(timer);
  }, [reduceMotion]);

  return (
    <motion.span layout transition={SPRING} className="selection">
      <span className="selection-handle selection-handle-tl" />
      <span className="selection-handle selection-handle-tr" />
      <span className="selection-handle selection-handle-bl" />
      <span className="selection-handle selection-handle-br" />
      <span className="selection-clip">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={word}
            className="selection-word"
            initial={{ y: "70%", opacity: 0, filter: "blur(8px)" }}
            animate={{ y: "0%", opacity: 1, filter: "blur(0px)" }}
            exit={{ y: "-70%", opacity: 0, filter: "blur(8px)" }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            {word}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.span>
  );
}

export default SelectionWord;
