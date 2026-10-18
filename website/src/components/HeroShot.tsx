import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { useRef, useState } from "react";

type HeroShotProps = {
  src: string;
  alt: string;
};

/** The file being compressed in the hero, in MB */
const ORIGINAL_SIZE = 26.2;
const COMPRESSED_SIZE = 5.1;
const SAVED_PERCENT = Math.round((1 - COMPRESSED_SIZE / ORIGINAL_SIZE) * 100);

/**
 * The app's screenshot under the hero. It starts tilted back & slightly smaller, then straightens
 * and settles flat as the page scrolls, like a laptop lid opening (scrolling back reverses it).
 * Meanwhile a glowing scan line sweeps down it: the app is dim & grey below the line and in full
 * colour above it, while a card counts the file's size down, until "Compressed".
 */
function HeroShot({ src, alt }: HeroShotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  // From when the image enters the bottom of the screen until its middle reaches the middle
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "center center"],
  });
  const progress = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 30,
    mass: 0.4,
  });
  const rotateX = useTransform(progress, [0, 1], [18, 0]);
  const scale = useTransform(progress, [0, 1], [0.86, 1]);
  const y = useTransform(progress, [0, 1], [-40, 0]);
  const shadow = useTransform(
    progress,
    [0, 1],
    [
      "0 60px 120px -40px rgba(0, 0, 0, 0.9)",
      "0 30px 80px -30px rgba(0, 0, 0, 0.7)",
    ],
  );

  // The compression: 0 to 100% from when the screenshot's top reaches 70% down the screen until
  // its bottom does, so the scan line stays about there while the screenshot scrolls under it,
  // from its top edge to its bottom edge
  const { scrollYProgress: scanProgress } = useScroll({
    target: ref,
    offset: ["start 70%", "end 70%"],
  });
  const percent = useTransform(
    useSpring(scanProgress, { stiffness: 140, damping: 30, mass: 0.4 }),
    [0, 1],
    [0, 100],
    { clamp: true },
  );
  // The line sweeps the whole screenshot; the part above it is in full colour
  const scanTop = useTransform(percent, (value) => `${value}%`);
  const doneClip = useTransform(percent, (value) =>
    value >= 100 ? "none" : `inset(0 0 ${100 - value}% 0)`,
  );
  const scanOpacity = useTransform(percent, [0, 2, 96, 100], [0, 1, 1, 0]);
  // The ring fills as it compresses (its length is 100, see `pathLength`)
  const ringOffset = useTransform(percent, (value) => 100 - value);

  const [shownPercent, setShownPercent] = useState(0);
  useMotionValueEvent(percent, "change", (value) => {
    setShownPercent(Math.round(value));
  });
  const isDone = reduceMotion || shownPercent >= 100;
  const size = reduceMotion
    ? COMPRESSED_SIZE
    : ORIGINAL_SIZE - ((ORIGINAL_SIZE - COMPRESSED_SIZE) * shownPercent) / 100;
  const saved = reduceMotion
    ? SAVED_PERCENT
    : Math.round((SAVED_PERCENT * shownPercent) / 100);

  return (
    <div ref={ref} className="hero-shot-stage">
      <motion.div
        className="hero-shot"
        style={
          reduceMotion
            ? undefined
            : {
                rotateX,
                scale,
                y,
                boxShadow: shadow,
                transformPerspective: 1400,
              }
        }
      >
        <div className="hero-shot-media">
          {/* Not compressed yet: dim & grey */}
          <img
            src={src}
            alt={alt}
            loading="eager"
            className="hero-shot-pending"
          />
          {/* Compressed: in full colour, down to the scan line */}
          <motion.img
            src={src}
            alt=""
            aria-hidden="true"
            loading="eager"
            className="hero-shot-done"
            style={{ clipPath: reduceMotion ? "none" : doneClip }}
          />
          {reduceMotion ? null : (
            <motion.div
              className="scan-line"
              style={{ top: scanTop, opacity: scanOpacity }}
              aria-hidden="true"
            />
          )}
        </div>

        <motion.div
          className={isDone ? "compress-card is-done" : "compress-card"}
          animate={isDone ? { scale: [1, 1.05, 1] } : { scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          aria-hidden="true"
        >
          <span className="compress-ring">
            <svg viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="34" className="compress-ring-track" />
              <motion.circle
                cx="40"
                cy="40"
                r="34"
                pathLength={100}
                strokeDasharray="100"
                className="compress-ring-fill"
                style={{ strokeDashoffset: reduceMotion ? 0 : ringOffset }}
              />
            </svg>
            <AnimatePresence mode="wait" initial={false}>
              {isDone ? (
                <motion.svg
                  key="check"
                  className="compress-ring-check"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ opacity: 0, scale: 0.4 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.4 }}
                  transition={{ duration: 0.25 }}
                >
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </motion.svg>
              ) : (
                <motion.span
                  key="percent"
                  className="compress-ring-percent"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {shownPercent}%
                </motion.span>
              )}
            </AnimatePresence>
          </span>
          <span className="compress-card-text">
            <span className="compress-card-status">
              {isDone ? null : <span className="compress-card-pulse" />}
              {isDone ? (
                "Compressed"
              ) : (
                <>
                  Compressing
                  <span className="compress-card-detail"> 4K video</span>
                </>
              )}
            </span>
            <span className="compress-card-size">
              {size.toFixed(1)}
              <span>MB</span>
            </span>
            <span className="compress-card-from">
              from {ORIGINAL_SIZE} MB
              <span className="compress-card-saved">−{saved}%</span>
            </span>
          </span>
        </motion.div>
      </motion.div>
    </div>
  );
}

export default HeroShot;
