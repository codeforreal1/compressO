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

/** The ring of the progress badge: its radius & circumference */
const RING_RADIUS = 15;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * The app's screenshot under the hero. It starts tilted back & slightly smaller, then straightens
 * and settles flat as the page scrolls, like a laptop lid opening (scrolling back reverses it).
 * A badge on it mimics the app compressing, its progress following the scroll, until "Compressed".
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

  // The badge: 0 to 100% over the scroll, done a little before the image is fully flat
  const percent = useTransform(progress, [0.05, 0.95], [0, 100], {
    clamp: true,
  });
  const ringOffset = useTransform(percent, [0, 100], [RING_LENGTH, 0]);
  const [shownPercent, setShownPercent] = useState(0);
  useMotionValueEvent(percent, "change", (value) => {
    setShownPercent(Math.round(value));
  });
  const isDone = reduceMotion || shownPercent >= 100;

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
        <img src={src} alt={alt} loading="eager" />

        <motion.div
          className="compress-badge"
          animate={isDone ? { scale: [1, 1.06, 1] } : { scale: 1 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          aria-hidden="true"
        >
          <span className="compress-ring">
            <svg width="38" height="38" viewBox="0 0 38 38">
              <circle
                cx="19"
                cy="19"
                r={RING_RADIUS}
                className="compress-ring-track"
              />
              <motion.circle
                cx="19"
                cy="19"
                r={RING_RADIUS}
                className="compress-ring-fill"
                strokeDasharray={RING_LENGTH}
                style={{ strokeDashoffset: reduceMotion ? 0 : ringOffset }}
              />
            </svg>
            <AnimatePresence initial={false}>
              {isDone ? (
                <motion.svg
                  key="check"
                  className="compress-check"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{ duration: 0.25 }}
                >
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </motion.svg>
              ) : null}
            </AnimatePresence>
          </span>
          <span className="compress-text">
            <span className="compress-label">
              {isDone ? "Compressed" : "Compressing"}
            </span>
            <span className="compress-value">
              {isDone ? "231 MB saved" : `${shownPercent}%`}
            </span>
          </span>
        </motion.div>
      </motion.div>
    </div>
  );
}

export default HeroShot;
