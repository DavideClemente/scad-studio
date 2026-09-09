// Curated OpenSCAD builtins used for hover/completion fallback. Explicitly
// extensible, not exhaustive — the tokenizer's own builtin list in
// scadLanguage.ts is intentionally left decoupled from this doc content.

export type ScadBuiltin = {
  name: string;
  signature: string;
  doc: string;
};

const BUILTINS: ScadBuiltin[] = [
  { name: 'cube', signature: 'cube(size, center = false)', doc: 'Creates a cube with its lower left corner at the origin (or centered, if `center` is true).' },
  { name: 'sphere', signature: 'sphere(r | d)', doc: 'Creates a sphere centered at the origin.' },
  { name: 'cylinder', signature: 'cylinder(h, r1, r2, center = false)', doc: 'Creates a cylinder or cone centered on the z-axis.' },
  { name: 'polyhedron', signature: 'polyhedron(points, faces)', doc: 'Creates an arbitrary polyhedron from a list of points and faces.' },
  { name: 'polygon', signature: 'polygon(points, paths)', doc: 'Creates a 2D polygon from a list of points, optionally with holes via `paths`.' },
  { name: 'circle', signature: 'circle(r | d)', doc: 'Creates a 2D circle at the origin.' },
  { name: 'square', signature: 'square(size, center = false)', doc: 'Creates a 2D square or rectangle at the origin.' },
  { name: 'offset', signature: 'offset(r | delta, chamfer = false)', doc: 'Grows or shrinks a 2D shape by the given amount.' },
  { name: 'translate', signature: 'translate(v)', doc: 'Translates its child elements by vector `v`.' },
  { name: 'rotate', signature: 'rotate(a, v)', doc: 'Rotates its child elements by angle `a` around axis/vector `v`.' },
  { name: 'scale', signature: 'scale(v)', doc: 'Scales its child elements by vector `v`.' },
  { name: 'mirror', signature: 'mirror(v)', doc: 'Mirrors its child elements across a plane through the origin, normal to `v`.' },
  { name: 'multmatrix', signature: 'multmatrix(m)', doc: 'Applies an arbitrary affine transformation matrix to its child elements.' },
  { name: 'resize', signature: 'resize(newsize)', doc: 'Scales its child elements so their bounding box matches `newsize`.' },
  { name: 'color', signature: 'color(c, alpha = 1)', doc: 'Renders its child elements in the given color.' },
  { name: 'union', signature: 'union()', doc: 'Creates the union of its child elements.' },
  { name: 'difference', signature: 'difference()', doc: 'Subtracts the following child elements from the first.' },
  { name: 'intersection', signature: 'intersection()', doc: 'Creates the intersection of its child elements.' },
  { name: 'hull', signature: 'hull()', doc: 'Creates the convex hull of its child elements.' },
  { name: 'minkowski', signature: 'minkowski()', doc: 'Creates the Minkowski sum of its child elements.' },
  { name: 'linear_extrude', signature: 'linear_extrude(height, twist, scale, slices)', doc: 'Extrudes a 2D shape along the z-axis into a 3D solid.' },
  { name: 'rotate_extrude', signature: 'rotate_extrude(angle = 360)', doc: 'Extrudes a 2D shape by rotating it around the z-axis.' },
  { name: 'text', signature: 'text(text, size = 10, font)', doc: 'Creates 2D text as a set of polygons.' },
  { name: 'import', signature: 'import(file, convexity)', doc: 'Imports a 3D model or 2D shape from an external file.' },
  { name: 'projection', signature: 'projection(cut = false)', doc: 'Projects a 3D shape into the 2D xy-plane.' },
  { name: 'surface', signature: 'surface(file, center = false)', doc: 'Creates a shape from a heightmap image or text file.' },
  { name: 'render', signature: 'render(convexity)', doc: 'Forces full CSG evaluation of its child elements.' },
  { name: 'children', signature: 'children(index)', doc: 'Refers to the child elements passed to a module, all of them by default.' },
  { name: 'echo', signature: 'echo(...)', doc: 'Prints its arguments to the console.' },
  { name: 'assert', signature: 'assert(condition, message)', doc: 'Evaluates a condition and halts with a message if it is false.' },
  { name: 'abs', signature: 'abs(x)', doc: 'Absolute value.' },
  { name: 'sign', signature: 'sign(x)', doc: 'Returns -1, 0, or 1 depending on the sign of x.' },
  { name: 'min', signature: 'min(a, b, ...)', doc: 'Returns the smallest of its arguments (or of a list).' },
  { name: 'max', signature: 'max(a, b, ...)', doc: 'Returns the largest of its arguments (or of a list).' },
  { name: 'sqrt', signature: 'sqrt(x)', doc: 'Square root.' },
  { name: 'pow', signature: 'pow(base, exponent)', doc: 'Raises base to exponent.' },
  { name: 'sin', signature: 'sin(degrees)', doc: 'Sine of an angle in degrees.' },
  { name: 'cos', signature: 'cos(degrees)', doc: 'Cosine of an angle in degrees.' },
  { name: 'tan', signature: 'tan(degrees)', doc: 'Tangent of an angle in degrees.' },
  { name: 'asin', signature: 'asin(x)', doc: 'Arcsine, in degrees.' },
  { name: 'acos', signature: 'acos(x)', doc: 'Arccosine, in degrees.' },
  { name: 'atan', signature: 'atan(x)', doc: 'Arctangent, in degrees.' },
  { name: 'atan2', signature: 'atan2(y, x)', doc: 'Two-argument arctangent, in degrees.' },
  { name: 'floor', signature: 'floor(x)', doc: 'Rounds down to the nearest integer.' },
  { name: 'ceil', signature: 'ceil(x)', doc: 'Rounds up to the nearest integer.' },
  { name: 'round', signature: 'round(x)', doc: 'Rounds to the nearest integer.' },
  { name: 'len', signature: 'len(x)', doc: 'Length of a string, vector, or list.' },
  { name: 'str', signature: 'str(...)', doc: 'Concatenates its arguments into a string.' },
  { name: 'chr', signature: 'chr(x)', doc: 'Converts a numeric character code (or list of codes) to a string.' },
  { name: 'ord', signature: 'ord(s)', doc: 'Returns the character code of the first character of a string.' },
  { name: 'concat', signature: 'concat(a, b, ...)', doc: 'Concatenates lists.' },
  { name: 'lookup', signature: 'lookup(key, table)', doc: 'Linearly interpolates a value from a table of key/value pairs.' },
  { name: 'search', signature: 'search(match, list)', doc: 'Searches a list or string for matching values, returning indices.' },
  { name: 'is_undef', signature: 'is_undef(x)', doc: 'True if x is undefined.' },
  { name: 'is_bool', signature: 'is_bool(x)', doc: 'True if x is a boolean.' },
  { name: 'is_num', signature: 'is_num(x)', doc: 'True if x is a number.' },
  { name: 'is_string', signature: 'is_string(x)', doc: 'True if x is a string.' },
  { name: 'is_list', signature: 'is_list(x)', doc: 'True if x is a list.' },
  { name: 'is_function', signature: 'is_function(x)', doc: 'True if x is a function literal.' },
  { name: 'norm', signature: 'norm(v)', doc: 'Euclidean length (magnitude) of a vector.' },
  { name: 'cross', signature: 'cross(a, b)', doc: 'Cross product of two vectors.' },
  { name: 'rands', signature: 'rands(min, max, count, seed)', doc: 'Returns a list of random numbers in [min, max].' },
  { name: 'textmetrics', signature: 'textmetrics(text, size, font)', doc: 'Returns layout metrics for a text() call without rendering it.' },
];

export const SCAD_BUILTINS_BY_NAME: Map<string, ScadBuiltin> = new Map(BUILTINS.map((b) => [b.name, b]));

export const SCAD_BUILTIN_NAMES: Set<string> = new Set(BUILTINS.map((b) => b.name));
