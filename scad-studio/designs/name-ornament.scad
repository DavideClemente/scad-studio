// ============================================================
//  Carolina — personalised Christmas bauble
//
//  One flat profile, extruded once: prints lying on the bed with no
//  supports. Edit anything below and hit Render.
// ============================================================

name        = "Carolina";
diameter    = 70;   // mm across the round part (the loop adds a little on top)
thickness   = 3;  // mm
// Available faces, and how many of twelve test names each one got through this
// design in a single connected piece. Norican is the default because it holds
// together at its own weight; the two behind it only manage it by being fattened.
//   "Norican"         text_bold = 0.05    12/12
//   "Dancing Script"  text_bold = 0.35    12/12
//   "Great Vibes"     text_bold = 0.35    12/12
//   "Lobster"         text_bold = 0.35    10/12
//   "Pacifico"        text_bold = 0.05     2/12 — hairline joints, opened away again
//   "Open Sans"       text_bold = 0.05     1/12 — not a script face; use connect = "swash"
font        = "Norican";
seed        = 42;       // change for a different set of snowflakes
// ...or floor(rands(0, 10000, 1)[0]) for a new set on every render
flake_count = 3;
flake_size  = 0.37;  // snowflake radius, as a fraction of the bauble radius

// --- how the name is held to the ring -----------------------------------
// The letters hold on to *each other* by themselves (see "seams" below); this
// is only about what carries the name across to the band.
//   "tie"       the outermost sliver of the end letters, drawn out to the band
//   "swash"     one line under the whole name, ring to ring (safest)
//   "none"      nothing; only use it if the render reports a single piece
connect     = "tie";

// --- tuning -------------------------------------------------------------
ring_width     = 2.6;   // width of the outer band
stroke         = 1;      // thinnest feature anywhere; keep it >= 2x your nozzle
text_bold      = 0.05;    // fattens thin script strokes so they print
weld           = 0.012;      // closes hairline gaps in the lettering, x text size
letter_spacing = 1.00;  // 1 is the face's own spacing; below 1 squeezes the letters
cap_tuck       = 0.12;   // how far the rest of the name slides under a capital, x text size
join_weld      = 0.08;    // fillet that closes a seam the script leaves open, x text size
text_fill      = 0.88;    // share of the inner width the name should span
text_height    = 0.5;    // cap on the name's height, x the bauble radius; raise it to
                         // make a short name fill the disc and shorten its ties
letter_gap     = 0.8;     // clearance the snowflakes keep from the lettering
tie_accents    = true;      // pin floating accents and i-dots onto their letter
swash_depth    = 0.10;                  // belly of the "swash" underline, x text size

$fs = 0.25;
$fa = 3;

// ---------------------------------------------------------------- geometry
R       = diameter / 2;
inner_r = R - ring_width;
fit_r   = inner_r - stroke * 1.2;
loop_or = R * 0.17;
loop_ir = loop_or * 0.42;

// ---- fit the name to the disc, using the real ink box of the glyphs ----
// Everything here is worked out at a reference size and scaled by s afterwards,
// because the size the name wants depends on how wide the name is, which depends
// on the tuck, which is measured in the same units.
REF = 100;

function metrics(ch) = textmetrics(text = ch, size = REF, font = font);
function adv(str) = textmetrics(text = str, size = REF, font = font,
                                spacing = letter_spacing).advance[0];
function prefix(n) = n <= 0 ? "" : chr([for (i = [0 : n - 1]) ord(name[i])]);

CAPITALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝÑ";
function is_upper(ch) = len(search(ch, CAPITALS)) > 0;

// Total tuck absorbed before glyph n: a script capital is drawn with the pen
// lifted afterwards, so the rest of the word is written in under it rather than
// after it. This is the same move a hand makes, and it is what brings the second
// letter close enough for the weld below to be a fillet instead of a slab.
function tucked(n) = n <= 0 ? 0
  : REF * cap_tuck * len([for (i = [0 : n - 1]) if (is_upper(name[i])) 1]);

// x of glyph n's own origin, at reference size. Taking the advance up to and
// including the glyph and removing the glyph's own advance keeps the kern pair
// between it and the letter before it — the advance of the prefix alone drops it,
// which is enough to slide a mark off its letter.
function pen_ref(n) = n <= 0 ? 0 : adv(prefix(n + 1)) - adv(name[n]) - tucked(n);

// One ink box per glyph that has ink, in reference units. A space has none.
boxes_ref = [for (k = [0 : len(name) - 1])
  let (m = metrics(name[k]), x = pen_ref(k))
  if (m.size[0] > 0)
    [x + m.position[0], m.position[1],
     x + m.position[0] + m.size[0], m.position[1] + m.size[1]]];

x_min = min([for (b = boxes_ref) b[0]]);
y_min = min([for (b = boxes_ref) b[1]]);
x_max = max([for (b = boxes_ref) b[2]]);
y_max = max([for (b = boxes_ref) b[3]]);
w0  = x_max - x_min;
h0  = y_max - y_min;
cx0 = (x_min + x_max) / 2;       // ink-box centre relative to the text anchor
cy0 = (y_min + y_max) / 2;

// the largest w0:h0 box that still fits the disc, then capped in width and
// height so short names don't balloon and long ones still clear the ring
s = min(2 * fit_r / sqrt(w0 * w0 + h0 * h0),   // box inscribed in the circle
        2 * fit_r * text_fill / w0,            // width cap
        R * text_height / h0);                 // height cap

text_size = REF * s;
weld_r    = text_size * weld;
anchor_x  = -cx0 * s;             // where the text's own origin ends up
baseline  = -cy0 * s;            // y of the baseline once the ink box is centred
ink_left  = -w0 * s / 2;
ink_right =  w0 * s / 2;

// glyph n's origin and ink width, at the size the name is actually drawn
function pen(n) = pen_ref(n) * s;
function glyph_w(ch) = metrics(ch).size[0] * s;

// x where the ring's inner face sits at a given height
function ring_x(y, sign) = sign * sqrt(pow(R - ring_width * 0.45, 2) - y * y);

module line2d(p1, p2, w) {
  hull() {
    translate(p1) circle(d = w, $fn = 16);
    translate(p2) circle(d = w, $fn = 16);
  }
}

// The lettering's footprint, one ink box per glyph. Snowflake strokes are stopped
// against these rather than being cut to shape afterwards: slicing an arm
// mid-branch leaves stubs attached to nothing, which is the exact failure this
// design exists to avoid. A stroke that is never drawn cannot come loose.
glyph_boxes = [for (b = boxes_ref)
  [[anchor_x + b[0] * s, baseline + b[1] * s],
   [anchor_x + b[2] * s, baseline + b[3] * s]]];

// Distance from o along unit direction d to the first hit on box b, grown by pad
// on every side. Slab method; 1e9 stands in for "never".
function ray_box(o, d, b, pad) =
  let (ix = abs(d[0]) < 1e-9 ? 1e9 : 1 / d[0],
       iy = abs(d[1]) < 1e-9 ? 1e9 : 1 / d[1],
       tx1 = (b[0][0] - pad - o[0]) * ix, tx2 = (b[1][0] + pad - o[0]) * ix,
       ty1 = (b[0][1] - pad - o[1]) * iy, ty2 = (b[1][1] + pad - o[1]) * iy,
       tmin = max(min(tx1, tx2), min(ty1, ty2)),
       tmax = min(max(tx1, tx2), max(ty1, ty2)))
  (tmax < 0 || tmin > tmax) ? 1e9 : max(tmin, 0);

// How far a stroke may run from o in direction d before it meets the name.
function clear_len(o, d, maxlen, pad) =
  min(concat([maxlen], [for (b = glyph_boxes) ray_box(o, d, b, pad)]));

// One randomised six-armed snowflake, centred on world point c and turned by rot.
// Every stroke is measured against the lettering first and stopped short of it,
// which is why this needs to know where it sits rather than being drawn at the
// origin and moved afterwards.
module snowflake(r, sd, c, rot) {
  q    = rands(0, 1, 12, sd);
  w    = max(stroke, r * 0.055);
  fine = w / r < 0.075;                  // is there room for fine detail?
  nb   = fine ? floor(2 + q[0] * 2.99) : 2;
  ba   = 32 + q[1] * 26;                 // branch angle
  b0   = 0.28 + q[2] * 0.14;             // where the first branch sits
  bl   = 0.26 + q[3] * 0.16;             // branch length
  hexr = (0.30 + q[4] * 0.22) * r;       // inner hexagon radius...
  hex  = fine && q[5] > 0.45;            // ...if this flake has one
  tip  = q[6] > 0.4;                     // arrowheads on the arm tips
  pad  = letter_gap + w / 2;

  // local point -> world, for measuring against the lettering
  function w_at(i, u, v) =
    let (a = rot + i * 60)
    [c[0] + u * cos(a) - v * sin(a), c[1] + u * sin(a) + v * cos(a)];
  function w_dir(i, deg) = let (a = rot + i * 60 + deg) [cos(a), sin(a)];

  translate(c) rotate([0, 0, rot]) for (i = [0 : 5]) {
    // how far this arm can run before it would touch a letter
    arm = clear_len(w_at(i, 0, 0), w_dir(i, 0), r, pad);

    rotate([0, 0, i * 60]) {
      if (arm > w * 0.5) line2d([0, 0], [arm, 0], w);

      for (j = [0 : nb - 1]) {
        f  = nb == 1 ? 0 : j / (nb - 1);
        t  = (b0 + (0.88 - b0) * f) * r;
        lb = bl * r * (1 - 0.45 * f);
        // a branch may only grow from a piece of arm that actually exists
        if (t <= arm) for (m = [1, -1]) {
          e = clear_len(w_at(i, t, 0), w_dir(i, m * ba), lb, pad);
          if (e > w * 0.5)
            line2d([t, 0], [t + e * cos(ba), m * e * sin(ba)], w);
        }
      }

      // The barbs splay sideways off the tip, so they need measuring too — the
      // arm's own clearance only covers its centreline.
      if (tip && arm >= r) for (m = [1, -1]) {
        e = clear_len(w_at(i, r, 0), w_dir(i, 180 - m * 45), r * 0.15, pad);
        if (e > w * 0.5)
          line2d([r, 0], [r - e * cos(45), m * e * sin(45)], w);
      }

      if (hex && hexr <= arm) {
        e = clear_len(w_at(i, hexr, 0), w_dir(i, 120), hexr, pad);
        if (e >= hexr) line2d([hexr, 0], [hexr * cos(60), hexr * sin(60)], w);
      }
    }
  }
  translate(c) circle(r * 0.085, $fn = 24);
}

module name_text() {
  // Closing the gaps can leave a razor where two glyph outlines almost touch —
  // a tenth of a millimetre of material that is not printable and not attached
  // to anything. Opening the result afterwards drops anything that thin; real
  // strokes are ten times wider and come through untouched.
  nick = stroke * 0.15;
  offset(r = nick) offset(r = -nick)
    offset(r = -weld_r) offset(r = weld_r)    // close hairline gaps
      offset(r = text_bold) {                 // and fatten for printing
        // Glyph by glyph rather than one text() call: the capitals are tucked, so
        // the letters no longer sit where the face would put them.
        for (k = [0 : len(name) - 1]) glyph_at(k, name[k]);
        seams();
      }
}

// Accents and the dots on i/j are separate contours floating above the letter, so
// they drop straight out of the print and have to be pinned back on.
//
// Where the mark actually sits can't be read off the metrics — in a slanted script
// an acute sits well right of centre while the ink box stays exactly as wide as the
// plain letter. So instead of guessing, the mark is cut out geometrically: an
// accented glyph is taller than its unaccented base, and everything above the base's
// height *is* the mark. Sweeping that shape straight down until it reaches the
// letter gives a connecting stroke in the mark's own width and slant.
//
// The sweep has to start long, since how far the mark floats above the letter is
// just as unknowable — so it is then clipped back to the letter's own height. What
// stays visible is a bridge exactly as tall as the real gap; the rest is buried
// inside the letter.
ACCENTS = "àáâãäåèéêëìíîïòóôõöùúûüýÿñÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝÑ";
// "ì í î ï" map to "o", not "i": a dotted i is as tall as the accent itself,
// which would put the cut above the mark and isolate nothing.
BASES   = "aaaaaaeeeeooooooooouuuuynAAAAAAEEEEIIIIOOOOOUUUUYN";
DOTTED  = "ij";

x_height = metrics("o").size[1] * s;
function ink_top(ch) = let (m = metrics(ch)) m.position[1] + m.size[1];

// the height the letter would reach without its mark: its base letter, or for
// i and j the x-height, since their stems stop there
function bare_top(ch) = let (hit = search(ch, ACCENTS))
  len(hit) > 0 ? ink_top(BASES[hit[0]]) : ink_top("o");

function is_marked(ch) = len(search(ch, ACCENTS)) > 0 || len(search(ch, DOTTED)) > 0;

module glyph_at(k, ch) {
  translate([anchor_x + pen(k), baseline]) text(ch, size = text_size, font = font);
}

// Just the free-floating mark of character k: everything of the glyph standing
// above the height its unaccented base reaches.
module mark(k, ch) {
  intersection() {
    glyph_at(k, ch);
    translate([-diameter, baseline + bare_top(ch) * s + stroke * 0.2])
      square([2 * diameter, diameter]);
  }
}

// Smear children straight down by h. minkowski rather than hull() of the two end
// positions: an "i" has two separate pieces up there, the top of its stem and its
// dot, and a hull would fill in the space between them.
module smear_down(h) {
  minkowski() {
    children();
    translate([0, -h / 2]) square([0.001, h], center = true);
  }
}

// One broad stroke rather than a dot or a thin tick: a tilde or a circumflex.
// Smearing one of these down whole walls off the gap under it, so they come down
// in legs instead. Everything else — dots, acutes, graves, and the two dots of a
// diaeresis, which the smear already keeps apart — is better off in one piece.
WIDE_MARKS = "âãêîôõûÂÃÊÎÔÕÛ";

// A column of a mark, w wide and centred on cx, widened sideways afterwards: a
// column that catches only the edge of a stroke would otherwise smear down into
// a blade far too thin to print.
module mark_column(k, ch, cx, w) {
  intersection() {
    minkowski() {
      intersection() {
        mark(k, ch);
        translate([cx - w / 2, -diameter]) square([w, 2 * diameter]);
      }
      square([w * 0.5, 0.001], center = true);
    }
    translate([cx - w, -diameter]) square([2 * w, 2 * diameter]);
  }
}

module accent_ties() {
  for (k = [0 : len(name) - 1]) {
    ch = name[k];
    if (is_marked(ch)) {
      // The mark is smeared down until it reaches the letter, then cut back to
      // the floor, so all that stays visible is a stub bridging the real gap —
      // in the mark's own width, which on an "i" reads as a stem under the dot.
      //
      // The floor sits well below the letter's highest point rather than level
      // with it: a round letter has ink at its own top for only an instant, so a
      // stub stopping there can hang off the side of the curve and touch nothing.
      dig   = x_height * 0.35;
      drop  = (ink_top(ch) - bare_top(ch)) * s + dig + text_bold;
      floor = baseline + bare_top(ch) * s - dig;

      gm  = metrics(ch);
      x0  = anchor_x + pen(k) + gm.position[0] * s;
      gw  = gm.size[0] * s;
      leg = max(stroke, text_size * 0.075);
      n   = len(search(ch, WIDE_MARKS)) > 0 ? max(2, round(gw / (leg * 3))) : 1;

      for (j = [0 : n - 1]) intersection() {
        smear_down(drop) {
          if (n == 1) mark(k, ch);
          else mark_column(k, ch, x0 + gw * (j + 0.5) / n, leg);
        }
        translate([-diameter, floor]) square([2 * diameter, 2 * diameter]);
      }
    }
  }
}

// ---- holding the letters to each other ---------------------------------
//
// A joined-up face already runs its lowercase letters into one another, so at the
// face's own spacing almost every seam is closed before anything is added: across
// a set of common names, the only ones left open are the seam after a capital —
// script capitals are drawn with the pen lifted afterwards — and a space, which
// carries no ink at all.
//
// Ruling a stroke along the baseline joins all of them at once, and that is what
// this design used to do. It is also what it looks like: a straight line crossing
// every letter it passes, coming out the far side of the ones whose strokes dip
// below it. So each open seam is closed on its own instead, where it is open.
//
// A capital's seam gets a fillet: dilating the two letters by r and eroding by r
// again leaves material only where they were already within 2r of each other, i.e.
// exactly at the point of closest approach, tapering out from it in both
// directions. Clipping that to a band across the seam keeps it from rounding off
// the insides of the letters themselves. Nothing crosses a glyph; the letters just
// meet, the way they would if the hand had not lifted.
module close_seam(a, b, r) {
  ma = metrics(name[a]);
  mb = metrics(name[b]);
  xe = anchor_x + pen(a) + (ma.position[0] + ma.size[0]) * s;   // right ink edge of a
  xs = anchor_x + pen(b) + mb.position[0] * s;                  // left ink edge of b
  lo = min(xe, xs) - r;
  hi = max(xe, xs) + r;
  intersection() {
    offset(r = -r) offset(r = r) children();
    translate([lo, -diameter]) square([hi - lo, 2 * diameter]);
  }
}

// A space is a real gap, far too wide for a fillet, so it does get a stroke — but
// only across the space itself, between the two letters either side of it, where
// there is nothing for it to cross. The fillet then closes whatever the stroke's
// ends do not quite reach.
module word_bridge(k) {
  a  = k - 1;
  b  = k + 1;
  ma = metrics(name[a]);
  mb = metrics(name[b]);
  x0 = anchor_x + pen(a) + (ma.position[0] + ma.size[0]) * s;
  x1 = anchor_x + pen(b) + mb.position[0] * s;
  w    = max(stroke, text_size * 0.055);
  y    = baseline + stroke * 0.15;
  bite = text_size * 0.05;

  line2d([x0 - bite, y], [x1 + bite, y], w);
  close_seam(a, b, text_size * join_weld) {
    glyph_at(a, name[a]);
    glyph_at(b, name[b]);
    line2d([x0 - bite, y], [x1 + bite, y], w);
  }
}

module seams() {
  r = text_size * join_weld;
  for (k = [0 : len(name) - 2]) {
    if (name[k] == " ") {
      if (k > 0) word_bridge(k);
    } else if (name[k + 1] != " " && is_upper(name[k])) {
      close_seam(k, k + 1, r) {
        glyph_at(k, name[k]);
        glyph_at(k + 1, name[k + 1]);
      }
    }
  }
}

// ---- holding the name to the ring --------------------------------------
//
// This used to be a stroke ruled along the baseline from inside the first letter
// out to the band, and the same on the right. Between them they ran the full width
// of the disc, a straight rule lying against the underside of the whole name.
//
// A tie instead starts as part of the letter and leaves it sideways: take the
// outermost sliver of ink of the end letter and drag that sliver straight out to
// the band. It is the letter's own edge, in the letter's own weight, so there is
// nothing to bed in and nothing to cut back — and it only spans the gap between
// the name and the band, which is a few millimetres when the name fills the disc.
module smear_x(dir, len) {
  minkowski() {
    children();
    translate([dir * len / 2, 0]) square([len, 0.001], center = true);
  }
}

// The outermost sliver of ink of the first (m = -1) or last (m = 1) letter. Kept
// hair-thin on purpose: at the very edge of a curve the ink is a short arc, and a
// wider bite would drag out a slab as tall as the arc is deep.
module edge_sliver(m, t) {
  k  = m < 0 ? 0 : len(name) - 1;
  gm = metrics(name[k]);
  gx = anchor_x + pen(k) + gm.position[0] * s;
  x  = m < 0 ? gx : gx + gm.size[0] * s - t;
  intersection() {
    glyph_at(k, name[k]);
    translate([x, -diameter]) square([t, 2 * diameter]);
  }
}

module ties() {
  w = max(stroke, text_size * 0.06);       // the tie's own weight
  for (m = [-1, 1])
    intersection() {
      // Rounding the sliver out to w first is what sets the tie's thickness: the
      // sliver itself can be a hair or a whole stem depending on where the letter
      // happens to end, and a hair would not print.
      smear_x(m, R) offset(r = w / 2) edge_sliver(m, text_size * 0.006);
      circle(R - ring_width * 0.45);       // stops halfway into the band, so they fuse
    }
}

// One line under the whole name, ring to ring. Its top edge sits just above the
// baseline so it bites into every glyph — the name is then a single piece
// however the letters happen to fall.
module swash() {
  bx    = ring_x(baseline, 1);
  top   = baseline + stroke * 0.3;
  t_end = stroke;
  t_mid = max(stroke * 1.4, text_size * swash_depth);
  n     = 72;
  lower = [for (i = [n : -1 : 0])
             let (x = -bx + 2 * bx * i / n)
             [x, top - t_end - (t_mid - t_end) * (1 - pow(x / bx, 2))]];
  polygon(concat([[-bx, top], [bx, top]], lower));
}

module letters() {
  name_text();
  if (tie_accents) accent_ties();
}

module flakes() {
  for (i = [0 : flake_count - 1]) {
    sd  = seed * 7 + i * 13;
    v   = rands(0, 1, 3, sd + 991);
    ang = [138, 42, -58, -122, 5, 175][i % 6] + (v[0] - 0.5) * 12;
    fr  = R * flake_size * [1.06, 0.94, 1.00, 0.97, 0.90, 0.90][i % 6] * (0.92 + v[1] * 0.16);
    pr  = R - fr * 0.85;                     // always far enough out to reach
    c   = [pr * cos(ang), pr * sin(ang)];

    intersection() {                         // trimmed flush with the outer edge
      circle(R);
      union() {
        snowflake(fr, sd, c, ang);
        // the arm aimed at the ring, extended until it bites into the band
        translate(c) rotate([0, 0, ang])
          line2d([0, 0], [R - ring_width * 0.3 - pr, 0], max(stroke, fr * 0.055));
      }
    }
  }
}

module ornament_2d() {
  union() {
    difference() { circle(R); circle(inner_r); }          // ring
    difference() {                                        // hanging loop
      translate([0, R + loop_or - max(ring_width, loop_or * 0.5)])
        difference() { circle(loop_or); circle(loop_ir); }
      circle(inner_r);      // ...cut flush with the ring's inner wall
    }

    letters();
    if (connect == "tie")   ties();
    if (connect == "swash")    swash();

    flakes();
  }
}

linear_extrude(height = thickness) ornament_2d();
