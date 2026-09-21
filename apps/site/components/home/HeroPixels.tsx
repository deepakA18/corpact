/**
 * The hero plate. Two 960x540 indexed PNGs of the same art: a night palette and a day palette,
 * both emitted from one scene description by tools/hero-plate.mjs, so the illustration follows the
 * theme instead of staying dark on a light page and the two can never drift apart.
 * Decorative only - the hero's meaning is carried by the heading beside it.
 *
 * The art itself is a 320x180 grid - every art pixel is expanded to a hard 3x3 block - so the look
 * stays deliberately chunky 8-bit while the emitted file is large enough to upscale exactly and
 * stay sharp on retina. The chunkiness is the style; do not "fix" it by smoothing.
 *
 * Bottom-anchored at width:100% inside an overflow:hidden box, so the city is never cropped
 * horizontally at any viewport and any overflow leaves through the top, which is flat sky.
 */
export function HeroPixels() {
  return (
    <div className="hero-pixels" aria-hidden="true">
      {/* eslint-disable @next/next/no-img-element */}
      <img className="plate-night" src="/hero-pixels.png" alt="" width={960} height={540} fetchPriority="high" />
      <img className="plate-day" src="/hero-pixels-day.png" alt="" width={960} height={540} />
      {/* eslint-enable @next/next/no-img-element */}
    </div>
  );
}
