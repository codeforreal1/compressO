import SelectionWord from "./SelectionWord";
import { ZoomInBounce } from "./effects/ZoomInBounce";

/** The app icon & the headline, whose last word cycles through the formats CompressO compresses */
function HeroAnimatedContent() {
  return (
    <>
      <ZoomInBounce>
        <img
          src="/app-icon.png"
          alt=""
          width={88}
          height={88}
          className="hero-icon"
        />
      </ZoomInBounce>
      <h1 className="sr-only">Compress any video, image or audio file</h1>
      <p className="hero-title" aria-hidden="true">
        <span className="hero-title-line">Compress any</span>
        <span className="hero-title-line">
          <SelectionWord />
        </span>
      </p>
    </>
  );
}

export default HeroAnimatedContent;
