/**
 * Fonts mounted into the OpenSCAD engine's virtual filesystem so `text()` works.
 * Without these fontconfig has nothing to find and every text object renders
 * empty. The files live in public/fonts/ and are all OFL/Apache licensed.
 */
export type ScadFont = {
  /** Filename under public/fonts/ */
  file: string;
  /** Family name to pass to OpenSCAD's `font =` */
  family: string;
  /**
   * How many of a battery of twelve real names come out of designs/
   * name-ornament.scad as a single connected solid, at this face's `bold` below.
   * Counted from the rendered mesh, not judged by eye.
   *
   * It is what picked the default. A face is only as good here as its lowercase
   * run: where letters merely graze each other the joint comes out thinner than
   * the design's minimum feature and gets opened away again, which is why the
   * lighter faces score badly and why more weight rescues some of them.
   */
  onePiece: number;
  /**
   * How much to fatten the glyphs, in mm, in a design that prints the lettering
   * as-is. Thin script faces need it to reach a printable stroke; faces that are
   * already heavy would only turn to mush.
   */
  bold: number;
};

export const FONTS: ScadFont[] = [
  { file: 'Norican-Regular.ttf', family: 'Norican', onePiece: 12, bold: 0.05 },
  { file: 'DancingScript.ttf', family: 'Dancing Script', onePiece: 12, bold: 0.35 },
  { file: 'GreatVibes-Regular.ttf', family: 'Great Vibes', onePiece: 12, bold: 0.35 },
  // 10 of 12 once bold goes up to 0.35.
  { file: 'Lobster-Regular.ttf', family: 'Lobster', onePiece: 3, bold: 0.05 },
  // Its lowercase joints are hairlines at this size; weight barely helps.
  { file: 'Pacifico-Regular.ttf', family: 'Pacifico', onePiece: 2, bold: 0.05 },
  // Not a script face at all — its letters never touch, so it needs the swash.
  { file: 'OpenSans.ttf', family: 'Open Sans', onePiece: 1, bold: 0.05 },
];

/** fontconfig needs a config file before it will look anywhere at all. */
export const FONTS_CONF = `<?xml version="1.0"?>
<fontconfig>
  <dir>/fonts</dir>
  <cachedir>/tmp/fontconfig</cachedir>
</fontconfig>
`;
