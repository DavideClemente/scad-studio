export type ScadExample = {
  id: string;
  name: string;
  source: string;
};

export const EXAMPLES: ScadExample[] = [
  {
    id: 'rounded-box',
    name: 'Rounded box',
    source: `// A simple rounded box - good starting point.

width = 40;
depth = 30;
height = 15;
radius = 4;

module rounded_box(w, d, h, r) {
  linear_extrude(height = h)
    offset(r = r)
      offset(delta = -r)
        square([w, d], center = true);
}

rounded_box(width, depth, height, radius);
`,
  },
  {
    id: 'wall-hook',
    name: 'Wall hook',
    source: `// Parametric wall hook, prints flat on the bed.

thickness = 4;
hook_length = 35;
hook_radius = 12;
screw_hole_d = 4.5;

module hook_profile() {
  difference() {
    union() {
      square([thickness, hook_length]);
      translate([thickness / 2, hook_length])
        circle(r = hook_radius);
    }
    translate([thickness / 2, hook_length])
      circle(r = hook_radius - thickness);
    translate([thickness / 2, 8])
      circle(d = screw_hole_d);
  }
}

linear_extrude(height = 10)
  hook_profile();
`,
  },
  {
    id: 'measuring-block',
    name: 'Measuring block',
    source: `// A block with one of every feature the Measure tool can pick, and every
// answer known in advance. Nothing here is parametric on purpose: the numbers in
// the comments are what the readout should say, so a wrong reading is obvious
// rather than merely plausible.

$fn = 60;   // so holes and bosses report "Segments 60"

difference() {
  union() {
    // Plate: corners at (±30, ±20, ±4).
    //   long edge 60.000, short edge 40.000, top to bottom 8.000
    //   corner to opposite corner across the top face   72.111
    cube([60, 40, 8], center = true);

    // Boss: outer wall ⌀18, top at z = 18.
    //   plate top to boss top   14.000
    translate([0, 0, 4]) cylinder(h = 14, r = 9);

    // Pin: ⌀10, top at z = 14.
    //   plate top to pin top    10.000
    //   pin top to boss top      4.000
    translate([-20, -13, 4]) cylinder(h = 10, r = 5);

    // Wedge: 14 of run rising 8.083, so its slope is exactly 30°.
    //   sloped face to plate top                      30.00°
    //   sloped face to its own back face (at x = 14)  60.00°
    translate([14, 6, 4])
      rotate([90, 0, 0])
        linear_extrude(height = 12)
          polygon([[0, 0], [14, 0], [0, 8.083]]);
  }

  // Bore down the middle of the boss: ⌀8, floor at z = 4.
  //   boss top to bore floor   14.000
  translate([0, 0, 4]) cylinder(h = 30, r = 4);

  // Two through holes, ⌀5, at (-22, 12) and (22, -12).
  translate([-22, 12, 0]) cylinder(h = 30, r = 2.5, center = true);
  translate([22, -12, 0]) cylinder(h = 30, r = 2.5, center = true);
}

// Press Measure, then try pointing at:
//
//   a hole                    Circle ⌀5.000 mm, before clicking anything
//   the middle of one         Centre ⌀5.000 mm - a hole's centre is a place too
//   the pin's curved side     Cylinder ⌀10.000 mm
//   the plate's top           Round face - the ring nearest the pointer, so
//                             ⌀18.000 by the boss and ⌀5.000 by a hole
//
// and then at two things:
//
//   both hole centres         50.120 mm, with ΔX 44.000 and ΔY -24.000
//   both hole rims            45.120 mm between circles, 50.120 between centres
//   plate top, then boss top  14.000 mm between faces
//   sloped face, plate top    30.00° between faces
//   two opposite corners      60.000 mm along an edge, 72.111 across the face
//   one corner on its own     its X/Y/Z in the coordinates this file uses
`,
  },
  {
    id: 'toothed-wheel',
    name: 'Toothed wheel',
    source: `// A simple toothed wheel silhouette, built with a for loop.

teeth = 18;
outer_r = 30;
inner_r = 24;
height = 8;

module wheel() {
  linear_extrude(height = height)
    union() {
      circle(r = inner_r, $fn = 80);
      for (i = [0 : teeth - 1]) {
        rotate([0, 0, i * 360 / teeth])
          translate([outer_r - 2, 0])
            circle(r = 3, $fn = 12);
      }
    }
}

wheel();
`,
  },
  {
    id: 'loose-pieces',
    name: 'Three separate pieces',
    source: `// Three shapes spaced far enough apart that none of them touch -
// a design made of more than one piece, rather than one connected whole.

gap = 20;

translate([-gap, 0, 0])
  cube(14, center = true);

sphere(r = 9, $fn = 48);

translate([gap, 0, 0])
  cylinder(h = 16, r = 7, center = true, $fn = 48);
`,
  },
];

export const DEFAULT_SOURCE = EXAMPLES[0].source;
