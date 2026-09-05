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
];

export const DEFAULT_SOURCE = EXAMPLES[0].source;
