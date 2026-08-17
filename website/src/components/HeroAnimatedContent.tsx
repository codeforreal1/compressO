import { motion } from "framer-motion";

import { TextFade } from "./effects/TextFade";
import TextSlot from "./effects/TextSlot";
import { ZoomInBounce } from "./effects/ZoomInBounce";

function HeroAnimatedContent() {
  return (
    <>
      <ZoomInBounce>
        <img
          src="/app-icon.png"
          alt="Compresso Logo"
          className="w-24 h-auto block mx-auto!"
        />
      </ZoomInBounce>
      <h1 style={{ visibility: "hidden", fontSize: "0" }}>
        Compress any video/image
      </h1>
      <h1 className="md:pl-37.5!">
        <span>Compress any </span>
        <TextSlot
          texts={[
            "video",
            "mp4",
            "png",
            "mov",
            "jpg",
            "avi",
            "jpeg",
            "mkv",
            "webp",
            "webm",
            "gif",
            "svg",
            "image",
          ]}
          mainClassName="inline-block md:min-w-[320px] mx-auto text-center flex justify-center"
          staggerFrom={"first"}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "-120%" }}
          staggerDuration={0.025}
          splitLevelClassName="overflow-hidden pb-0.5 sm:pb-1 md:pb-1"
          transition={{ type: "spring", damping: 30, stiffness: 400 }}
          rotationInterval={2000}
        />
        <br />
      </h1>
      <TextFade direction="down" className="subtitle">
        <p className="title mb-5! scale-[0.9]">Completely private</p>
      </TextFade>
    </>
  );
}

export default HeroAnimatedContent;
