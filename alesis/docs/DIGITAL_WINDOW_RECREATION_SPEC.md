# Digital Window Recreation Specification

## Purpose

This document is the normative visual specification for recreating the Jarvis digital window independently. A conforming implementation should produce the same sigil silhouettes, internal ring geometry, equatorial rune halo, star projection, color treatment, and ordered dithering at the same viewport, view angles, elapsed time, and quality setting.

The requirements are written to be portable across rendering engines. GLSL-style formulas are normative where exact geometry matters. Equivalent implementations in WGSL, Canvas, native graphics code, or another shader language are acceptable when their rendered output remains visually equivalent.

## Target Appliance and Implementation Status

The deployment target is a Raspberry Pi 4 Model B with 2 GB RAM driving a
Waveshare 4inch HDMI LCD in landscape orientation. The panel's native 480 by
800 resolution therefore produces an 800 by 480 CSS-pixel viewport when the
display is rotated for the application's landscape layout. At 384,000 pixels,
the renderer uses quality 56 and a dither scale of 1.15.

The appliance also targets a PiSugar S Plus 5000 mAh battery. The owned
Easycargo 30 by 30 by 7 mm fan is deferred unless thermal testing requires it
and direct display stacking leaves safe clearance. These parts constrain
deployment and power but do not change the normative rendering formulas below.
External addressable lighting is explicitly outside the MVP.

This document specifies a planned recreation. The current application does not
yet include the canvas, shader, sigil atlas, star panorama, camera input, or
presentation overlays described here. Conformance must not be inferred from the
current blue/cyan application styling.

## Visual Target

The scene is a full-surround celestial window rather than a flat animated wallpaper:

- a dim, cool-white photographic star panorama covers the celestial sphere;
- many sparse spell sigils occupy fixed spherical coordinates at varied angular sizes;
- every sigil combines a deterministic branching line-art silhouette with concentric rings, dashed rings, axes, spokes, spirals, starbursts, orbiting nodes, and faint radial fields;
- most internal layers counter-rotate, so the constructions feel mechanical rather than like spinning decals;
- an enormous cyan rune structure encircles the horizon and reads as distant architecture;
- ordered dithering keeps fine marks crisp instead of turning them into soft transparent fog;
- restrained crimson, violet, cyan, and gold light accumulates over a near-black starfield;
- a faint glass reflection and strong neutral vignette integrate the scene behind foreground UI.

The defining impression is intricate, fine-lined geometry suspended in deep space. Do not replace the marks with generic magic-circle icons, blur-heavy particles, neon wireframes, or random glyph sprites.

## Coordinate System and Camera

Render one full-screen triangle pair or equivalent full-screen primitive. Let `screenPosition` range from `(-1, -1)` to `(1, 1)`. Use a vertical field of view of exactly 62 degrees:

```glsl
float aspect = viewport.x / viewport.y;
float fieldOfView = radians(62.0);
vec3 ray = normalize(vec3(
  screenPosition.x * tan(fieldOfView * 0.5) * aspect,
  screenPosition.y * tan(fieldOfView * 0.5),
  -1.0
));
```

Apply view rotation in this order: roll around screen Z, pitch around X, then yaw around Y.

```glsl
ray = vec3(
  ray.x * cos(roll) - ray.y * sin(roll),
  ray.x * sin(roll) + ray.y * cos(roll),
  ray.z
);
ray = vec3(
  ray.x,
  ray.y * cos(pitch) - ray.z * sin(pitch),
  ray.y * sin(pitch) + ray.z * cos(pitch)
);
ray = vec3(
  ray.x * cos(yaw) - ray.z * sin(yaw),
  ray.y,
  ray.x * sin(yaw) + ray.z * cos(yaw)
);
```

Convert the rotated ray to equirectangular texture coordinates:

```glsl
vec2 uv = vec2(
  atan(ray.x, -ray.z) / (2.0 * PI) + 0.5,
  asin(clamp(ray.y, -1.0, 1.0)) / PI + 0.5
);
```

The panorama wraps horizontally and clamps vertically. Use linear minification and magnification filtering. WebGL 1 `mediump float` is the reference precision.

## Starfield

Use `apps/web/public/media/starmap_2020_4k.webp` as the reference panorama.

| Property | Required value |
| --- | --- |
| Dimensions | 4096 by 2048 pixels |
| Pixel format | WebP ARGB |
| SHA-256 | `1e2d069f0fe63fe3ef5eb2da1f20580802a31befb01d5476e718e2e50542423b` |
| Horizontal sampling | Repeat |
| Vertical sampling | Clamp to edge |
| Shader multiplier | `vec3(0.88, 0.90, 1.00)` |
| Final CSS filter | `saturate(108%) brightness(68%)` |

If redistribution of the exact asset is unavailable, use a true 2:1 equirectangular astronomical star map with a black background, dense small white stars, restrained blue-white variation, no illustrated constellations, and no prominent nebula photograph. An alternative asset will preserve the mood but cannot be pixel-identical.

## Deterministic Sigil Atlas

The branching silhouette inside each projected sigil comes from a six-cell, single-row alpha atlas. Each cell is 256 by 256 pixels. Render white strokes on transparent black, then sample the alpha channel only.

### Atlas configuration

```text
count       = 6
cellSize    = 256
seedPrefix  = "atlas"
cell seeds  = "atlas-0" through "atlas-5"
render time = 0
ringPeriod  = 0
```

All other tree values use this exact configuration:

```text
outerRadius     = 0.9
maxDepth        = 5
strokeWidth     = 2 px
color           = #ffffff
background      = transparent
firstLayerCount = 3
stopChance      = 0.35
branchiness     = 0.7
```

The current field chooses variants `0` through `3`; cells `4` and `5` remain baked for atlas compatibility.

### Seed hash and random generator

String seeds use this 32-bit hash. All multiplication is signed 32-bit `imul`, all shifts match JavaScript bitwise shifts, and the result is converted to unsigned 32-bit.

```js
function hashSeed(value) {
  let hash = 1779033703 ^ value.length;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  return (hash ^ (hash >>> 16)) >>> 0;
}
```

Advance that seed with Mulberry32:

```js
function makeRng(seed) {
  let state = typeof seed === "string" ? hashSeed(seed) : seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
```

Do not substitute another seeded generator. The silhouettes depend on the exact random sequence.

### Tree generation

The root is a circle centered at the canvas origin with radius `size / 2 * outerRadius`. Child shapes are chosen uniformly from `circle`, `triangle`, and `square`. Placements are chosen uniformly from `inscribed`, `edge`, and `midpoint`.

At depth 1, spawn exactly `firstLayerCount` children. At deeper levels:

1. Stop the branch when the next random value is below `stopChance`.
2. Otherwise test four possible children independently.
3. Spawn each child when its random value is below `branchiness ^ depth`.
4. Stop if no child passes.
5. Never grow children when `depth >= maxDepth`.

For each child, derive radius and center distance from its placement using one fresh random value for each range:

| Placement | Radius relative to parent | Center distance relative to parent |
| --- | --- | --- |
| `inscribed` | uniform `[0.45, 0.82)` | `0` |
| `edge` | uniform `[0.15, 0.35)` | uniform `[0.72, 1.00)` |
| `midpoint` | uniform `[0.22, 0.45)` | uniform `[0.40, 0.58)` |

Discard children with a radius below 1.5 pixels. Choose center angle uniformly over `[0, 2 * PI)`, then set `x = cos(angle) * distance` and `y = sin(angle) * distance`. Consume one additional random value for the unused static spin value and one for local rotation over `[0, 2 * PI)`. Maintaining this random-consumption order is required even though atlas cells are rendered at time zero.

Render recursively in the parent coordinate frame. Translate to the child center and rotate by its local rotation before stroking it and visiting its children. Circles use their stated radius. Triangles and squares use circumradius geometry. The triangle starts at `-PI / 2`; the square starts at `-PI / 4`. Use round joins and round caps.

### Atlas sampling

Map local sigil coordinates from approximately `[-1, 1]` to a cell:

```glsl
vec2 atlasPoint = geometry * 1.05;
vec2 localUv = atlasPoint * 0.5 + 0.5;
float column = mod(floor(variant), 6.0);
vec2 atlasUv = vec2((column + localUv.x) / 6.0, localUv.y);
float treeMask = texture2D(sigilAtlas, atlasUv).a;
```

Return zero outside the cell. Add the sampled mask to the sigil mark at weight `0.9`. The atlas texture uses linear filtering and clamps on both axes. Upload the canvas with WebGL's `UNPACK_FLIP_Y_WEBGL` enabled, then disable that pixel-store flag after upload. Omitting this upload flip vertically mirrors every branching silhouette relative to its rings.

## Shared Shape Functions

Use these edge conventions. Changing the smoothstep widths noticeably changes the line character.

```glsl
float lineSegment(vec2 point, vec2 start, vec2 end, float width) {
  vec2 segment = end - start;
  float along = clamp(dot(point - start, segment) / dot(segment, segment), 0.0, 1.0);
  return 1.0 - smoothstep(width, width * 2.0, length(point - start - segment * along));
}

float ring(vec2 point, float radius, float width) {
  return 1.0 - smoothstep(width, width * 2.0, abs(length(point) - radius));
}

float dashedRing(vec2 point, float radius, float width, float phase, float spokes) {
  float dash = smoothstep(-0.22, 0.28, sin(atan(point.y, point.x) * spokes + phase));
  return ring(point, radius, width) * dash;
}

float node(vec2 point, vec2 center, float radius) {
  return 1.0 - smoothstep(radius, radius * 1.8, length(point - center));
}

float radialField(vec2 point, float radius, float feather) {
  return 1.0 - smoothstep(radius, radius + feather, length(point));
}

float runeSpoke(vec2 point, float angle, float inner, float outer, float width) {
  vec2 direction = vec2(cos(angle), sin(angle));
  return lineSegment(point, direction * inner, direction * outer, width);
}

float starBurst(vec2 point, float rays, float width, float spin) {
  float rayMask = abs(sin(atan(point.y, point.x) * rays + spin));
  float spoke = 1.0 - smoothstep(0.0, width, rayMask);
  return spoke * (1.0 - smoothstep(0.08, 0.95, length(point)));
}

float spiralRune(vec2 point, float arms, float twist, float width, float phase) {
  float wave = sin(atan(point.y, point.x) * arms + length(point) * twist + phase);
  return (1.0 - smoothstep(0.0, width, abs(wave)))
    * (1.0 - smoothstep(0.04, 0.82, length(point)));
}
```

## Spherical Sigil Field

Use these shader hashes exactly:

```glsl
float hash11(float value) {
  return fract(sin(value * 127.1) * 43758.5453123);
}

float hash21(vec2 value) {
  return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 hash22(vec2 value) {
  return vec2(hash21(value + vec2(1.0, 0.0)), hash21(value + vec2(0.0, 1.0)));
}

float triWave(float value) {
  return abs(fract(value) - 0.5) * 2.0;
}
```

The logical field always reserves 108 primary positions. `quality` controls how many are evaluated: 56 below 700,001 pixels, 84 above 700,000 pixels, and 108 above 1,300,000 pixels.

For each integer index `i` from 0 through 107, stopping when `i >= quality`:

```glsl
vec2 seed = vec2(i * 1.13 + 3.7, i * 1.91 + 9.2);
vec2 jitter = hash22(seed);
vec2 center = vec2((i + 0.5) / 108.0, 0.04 + jitter.y * 0.92);
center.x = fract(center.x + (jitter.x - 0.5) * 0.34
  + sin(i * 0.33 + jitter.y * 2.0 * PI) * 0.04);
float radius = mix(0.015, 0.046, hash21(seed + 4.0));
float phase = hash21(seed + 7.0) * 2.0 * PI;
float variant = floor(hash21(seed + 12.0) * 4.0);
float layerOffset = hash21(seed + 19.0) * 2.0 * PI;
float shimmer = triWave(time * 0.05 + hash11(i + 1.0));
```

Add the primary sigil with time `time`, phase `phase + layerOffset`, and intensity `mix(0.82, 1.2, shimmer)`.

Add an echo when `quality > 54` or the index is even:

```glsl
center = vec2(
  fract(primaryCenter.x + 0.12 + jitter.y * 0.07),
  clamp(primaryCenter.y + (jitter.x - 0.5) * 0.09, 0.03, 0.97)
);
radius = primaryRadius * mix(0.52, 0.78, jitter.x);
time = primaryTime * 1.14;
phase = primaryPhase + 2.7;
variant = mod(primaryVariant + 1.0, 4.0);
intensity = 0.52;
```

When `quality > 90`, add a smaller twin:

```glsl
center = vec2(
  fract(primaryCenter.x - 0.16 - jitter.x * 0.08),
  clamp(primaryCenter.y + (jitter.y - 0.5) * 0.14, 0.02, 0.98)
);
radius = primaryRadius * mix(0.34, 0.55, hash21(seed + 31.0));
time = primaryTime * 0.82;
phase = primaryPhase - 1.9;
variant = mod(primaryVariant + 2.0, 4.0);
intensity = 0.34;
```

Latitude culling may skip a projected sigil only when:

```glsl
abs(rayLatitude - (center.y - 0.5) * PI) > radius * 1.3 * PI
```

### Sigil projection and rotation

Convert normalized center coordinates to longitude and latitude, build a tangent frame, and project the current ray into local coordinates:

```glsl
float longitude = (center.x - 0.5) * 2.0 * PI;
float latitude = (center.y - 0.5) * PI;
vec3 forward = vec3(sin(longitude) * cos(latitude), sin(latitude), -cos(longitude) * cos(latitude));
vec3 right = vec3(cos(longitude), 0.0, sin(longitude));
vec3 up = normalize(cross(right, forward));
float facing = dot(ray, forward);
if (facing <= 0.0) return 0.0;
vec2 point = vec2(dot(ray, right), dot(ray, up)) / (facing * radius * PI);
if (dot(point, point) > 1.69) return 0.0;
```

Create three local frames:

```glsl
float turn = time * (0.055 + variant * 0.008) + phase;
vec2 geometry = rotate(point, turn);
vec2 counter = rotate(point, turn * -0.74);
vec2 shimmerFrame = rotate(point, turn * 1.8);
float pulse = 0.92 + sin(time * 0.42 + phase) * 0.08;
```

`rotate(point, angle)` uses `vec2(cos(angle) * x - sin(angle) * y, sin(angle) * x + cos(angle) * y)`.

### Exact internal construction

Accumulate these masks additively, then clamp the result to `[0, 1]`:

```text
ring(point, 0.82 * pulse, 0.012)
ring(point, 0.71, 0.008)
dashedRing(point, 0.61, 0.010, -time*0.34 + phase, 8 + variant)
dashedRing(point, 0.48, 0.007,  time*0.26 - phase, 10 + variant*2)
dashedRing(point, 0.34, 0.005,  time*0.55 + phase*0.3, 16)
dashedRing(point, 0.22, 0.004, -time*0.75 + phase, 20 + variant*3)
dashedRing(counter, 0.56, 0.005, time*0.46 + phase*1.3, 24 + variant*4)
ring(shimmerFrame, 0.14, 0.003)
ring(counter, 0.11, 0.003)
ring(geometry, 0.27, 0.003)
atlasMask(geometry * 1.05, variant) * 0.9
```

Add axes and diagonals:

```text
counter: (-.68,0) to (.68,0), width .007
counter: (0,-.68) to (0,.68), width .007
counter: (-.48,-.48) to (.48,.48), width .005
counter: (.48,-.48) to (-.48,.48), width .005
shimmerFrame: (-.56,-.56) to (.56,.56), width .004
shimmerFrame: (.56,-.56) to (-.56,.56), width .004
```

Let `spokeSeed = phase * 0.4 + variant`. Add spokes:

```text
counter at spokeSeed + 0, 1.047, 2.094: inner .17, outer .43, width .006
counter at spokeSeed + 3.14159: inner .11, outer .37, width .005
shimmerFrame at spokeSeed + .33, 1.89: inner .06, outer .31, width .004
geometry at spokeSeed + 2.62: inner .09, outer .28, width .004
```

Add weighted bursts and spirals:

```text
starBurst(shimmerFrame, 6 + variant*2, .08,  time*.31 + phase) * .28
starBurst(counter,       9 + variant*3, .09, -time*.28 + phase) * .22
starBurst(geometry,     12 + variant*2, .10,  time*.44 - phase*.6) * .17
spiralRune(geometry,     4 + variant,  11, .09,  time*.6 + phase) * .24
spiralRune(shimmerFrame, 7 + variant, -14, .08, -time*.7 + phase*.3) * .18
spiralRune(counter,      5 + variant,  17, .07,  time*.52 - phase*.4) * .14
```

Let `nodeAngle = time * 0.23 + phase`. Add five nodes:

```text
angle  nodeAngle,                 orbit .61, radius .035
angle -nodeAngle*.73,             orbit .48, radius .025
angle  nodeAngle*1.24 + 1.9,      orbit .34, radius .020
angle  nodeAngle*-1.48 + .8,      orbit .22, radius .016
angle  nodeAngle*2.2 + 2.7,       orbit .74, radius .022
```

Finally add three faint radial fields:

```text
radialField(point, .94, .36) * .22
radialField(point, .62, .22) * .12
radialField(point, .31, .14) * .08
```

## Equatorial Rune Halo

The halo is a spherical band centered on latitude zero. It must read as a huge distant structure, not as another local sigil.

Use:

```text
band half-height       = 2.5 degrees
inner channel latitude = +/-0.58 degrees
soft edge              = 0.35 degrees
line half-width        = 0.045 degrees
longitude cells        = 140
longitudinal drift     = time * 0.015
```

Construct the band and its five continuous lines exactly:

```glsl
float distanceFromCenter = abs(latitude);
float insideBand = 1.0 - smoothstep(
  bandHalf - softEdge,
  bandHalf + softEdge * 0.4,
  distanceFromCenter
);
float topLine = 1.0 - smoothstep(lineWidth, lineWidth * 3.2, abs(latitude - bandHalf));
float bottomLine = 1.0 - smoothstep(lineWidth, lineWidth * 3.2, abs(latitude + bandHalf));
float channelTop = 1.0 - smoothstep(
  lineWidth * 0.7,
  lineWidth * 2.4,
  abs(latitude - channelHalf)
);
float channelBottom = 1.0 - smoothstep(
  lineWidth * 0.7,
  lineWidth * 2.4,
  abs(latitude + channelHalf)
);
float channelLine = (1.0 - smoothstep(
  lineWidth * 0.35,
  lineWidth * 1.4,
  distanceFromCenter
)) * 0.62;
float mainAndChannelLines = clamp(
  topLine + bottomLine + channelTop + channelBottom + channelLine,
  0.0,
  1.0
);
```

Draw main lines at latitudes `+/-2.5 degrees` with smoothstep widths `lineWidth` to `lineWidth * 3.2`. Draw inner channel lines at `+/-0.58 degrees` with widths `lineWidth * 0.7` to `lineWidth * 2.4`. Draw the center line with widths `lineWidth * 0.35` to `lineWidth * 1.4`, weighted by `0.62`.

Map longitude into cells:

```glsl
float cellSpan = longitude * 140.0 / (2.0 * PI) + time * 0.015;
float cellId = floor(cellSpan);
float cellFrac = fract(cellSpan);
float glyphSeed = hash11(cellId + 41.0);
vec2 local = vec2(
  (cellFrac - 0.5) * 2.0,
  (clamp((latitude + bandHalf) / (2.0 * bandHalf), 0.0, 1.0) - 0.5) * 2.0
);
```

Choose `floor(glyphSeed * 4)`:

1. Diamond: `1 - smoothstep(0.05, 0.1, abs(abs(local.x) + abs(local.y) - 0.62))`.
2. Ring: `ring(local, 0.56, 0.07)` plus a vertical segment from `(0,-0.56)` to `(0,0.56)` at width `0.05`.
3. Crossed diagonals from `(-0.5,-0.6)` to `(0.5,0.6)` and `(0.5,-0.6)` to `(-0.5,0.6)`, width `0.06`, plus `ring(local, 0.22, 0.05)`.
4. `dashedRing(local, 0.6, 0.08, glyphSeed * 2 * PI, 5)` plus a center node of radius `0.14`.

Fade every glyph at cell edges with `smoothstep(0.02, 0.16, cellFrac) * smoothstep(0.02, 0.16, 1 - cellFrac)`.

Add these structural details:

```glsl
float tickEdge = 1.0 - smoothstep(0.018, 0.052, min(cellFrac, 1.0 - cellFrac));
float tickHeight = mix(
  radians(0.36),
  radians(1.18),
  step(0.72, hash11(cellId + 63.0))
);
float scaleTick = tickEdge * (1.0 - smoothstep(
  lineWidth * 0.8,
  lineWidth * 1.8,
  abs(latitude) - tickHeight
));
float channelNotch = (1.0 - smoothstep(0.018, 0.05, abs(cellFrac - 0.5)))
  * (1.0 - smoothstep(radians(0.05), radians(0.12), abs(latitude)));
float rungGate = step(0.55, hash11(cellId + 7.0));
float rung = (1.0 - smoothstep(0.02, 0.06, abs(cellFrac - 0.5))) * rungGate;
float shimmer = 0.85 + 0.15 * sin(time * 0.4 + cellId * 1.7);
```

Combine the interior pattern as:

```glsl
pattern = clamp(
  glyph * shimmer + rung * 0.6 + scaleTick * 0.72 + channelNotch * 0.38,
  0.0,
  1.0
) * insideBand;
halo = clamp(pattern * 0.85 + mainAndChannelLines, 0.0, 1.0);
```

Color the halo by latitude, interpolating from `vec3(0.02, 0.42, 0.62)` to `vec3(0.55, 0.98, 1.0)` across the band. Add it to the final color at weight `0.9`.

## Ordered Dithering

Use this exact normalized 4 by 4 Bayer threshold matrix in screen pixel coordinates:

```text
 0.5  8.5  2.5 10.5
12.5  4.5 14.5  6.5
 3.5 11.5  1.5  9.5
15.5  7.5 13.5  5.5
```

Divide every entry by 16. Address it with `mod(floor(gl_FragCoord.xy / ditherScale), 4)`. Set `ditherScale` to `1.15` up to 1,300,000 canvas pixels and `1.35` above that threshold.

After adding the halo mask to the sigil mask, clamp the combined mark to `[0, 1]`. Then compute:

```glsl
float ditheredMarks = step(ditherThreshold, marks) * (0.74 + ditherThreshold * 0.26);
```

Do not replace this with random noise, alpha blending, or temporal dithering. The fixed pattern is part of the crisp engraved appearance and prevents frame-to-frame sparkle.

## Color and Light Composition

All values below are direct shader additions before the final CSS filter. The reference does not explicitly decode the sampled panorama to a linear-light color space. Preserve this arithmetic and order; do not introduce color-space conversion or tone mapping between additions.

```glsl
float aurora = 0.5 + 0.5 * sin(ray.y * 16.0 + ray.x * 7.5 - time * 0.65);
aurora *= smoothstep(-0.35, 0.55, ray.y + sin(time * 0.15) * 0.12);

float flareBand = smoothstep(0.2, 0.88, marks)
  * (0.6 + 0.4 * sin(time * 0.8 + ray.x * 18.0 + ray.y * 14.0));
float prism = 0.5 + 0.5 * sin(ray.x * 28.0 + ray.y * 19.0 + time * 0.9);
float nebula = smoothstep(0.1, 1.0, aurora)
  * (0.55 + 0.45 * sin(time * 0.33 + ray.x * 9.0));
float corona = smoothstep(0.52, 1.0, marks)
  * (0.5 + 0.5 * sin(time * 1.6 + ray.x * 34.0));

vec3 crimson = vec3(1.0, 0.15, 0.24);
vec3 violet = vec3(0.72, 0.28, 1.0);
vec3 cyan = vec3(0.20, 0.96, 0.88);
vec3 gold = vec3(1.0, 0.78, 0.28);
vec3 ember = mix(crimson, violet, 0.45 + 0.45 * sin(time * 0.37 + ray.x * 5.0));
vec3 prismColor = mix(violet, cyan, prism);
vec3 auroraColor = vec3(0.14, 0.48, 0.44) * aurora * 0.16;

float bloom = smoothstep(0.4, 1.0, marks)
  * (0.74 + 0.26 * sin(time * 1.1 + ray.y * 21.0));
float spectral = smoothstep(0.2, 0.95, marks)
  * (0.5 + 0.5 * sin(time * 0.63 + ray.x * 31.0 - ray.y * 17.0));
```

Compose:

```glsl
vec3 color = stars.rgb * vec3(0.88, 0.90, 1.00);
color += ember * ditheredMarks * 0.66;
color += prismColor * flareBand * 0.28;
color += mix(cyan, crimson, spectral) * bloom * 0.18;
color += mix(gold, cyan, prism) * corona * 0.12;
color += auroraColor;
color += vec3(0.10, 0.03, 0.14) * marks * 0.30;
color += vec3(0.06, 0.09, 0.15) * nebula * 0.20;
color += vec3(0.08, 0.05, 0.18) * smoothstep(0.35, 2.7, marks) * 0.14;
color += haloColor * 0.90;
```

Output opaque color. Do not add a conventional blur or multipass bloom; the layered masks provide the glow while retaining fine lines.

## Presentation Layers

The window host extends beyond the viewport by `6vh` vertically and `6vw` horizontally to hide moving edges. The canvas fills that host. Apply `saturate(108%) brightness(68%)` to the canvas.

Overlay a screen-blended glass layer:

```css
background:
  linear-gradient(115deg,
    rgb(255 255 255 / 2.5%),
    transparent 24%,
    transparent 72%,
    rgb(255 255 255 / 1.5%)),
  radial-gradient(90% 65% at 50% -8%,
    rgb(255 255 255 / 4%),
    transparent 62%);
mix-blend-mode: screen;
```

Overlay the vignette above the glass:

```css
inset: -2%;
background: radial-gradient(
  140% 120% at 50% 52%,
  rgb(213 47 54 / 7%) 0%,
  rgb(7 9 9 / 46%) 55%,
  rgb(5 7 7 / 90%) 100%
);
```

The fallback while textures or shaders load is the same star panorama rendered with `background-size: cover`, centered, and passed through the same saturation and brightness filter. Fade that fallback out over 300 ms only after the renderer is ready.

## Conformance Priorities

When exact reproduction and platform constraints conflict, preserve features in this order:

1. Seed hash, random generator, tree-generation order, atlas settings, and atlas alpha sampling.
2. Internal sigil ring, axis, spoke, spiral, burst, node, and radial-field formulas.
3. Spherical placement hashes, projection, variant choice, and animation rates.
4. Equatorial halo geometry, glyph selection, and cyan latitude gradient.
5. Bayer matrix, addressing, thresholding, and dither scale.
6. Star panorama projection and color multiplier.
7. Color accumulation order and coefficients.
8. Glass and vignette presentation layers.

A recreation is not conforming if it uses the same palette but substitutes different sigil silhouettes or ring geometry.

## Verification Frames

Compare implementations using an opaque canvas, zero yaw, pitch, and roll, and these fixed inputs:

| Frame | Viewport | Time | Quality | Dither scale |
| --- | --- | --- | --- | --- | --- |
| A | 960 by 540 | 0.0 s | 56 | 1.15 |
| B | 1920 by 1080 | 12.5 s | 108 | 1.35 |
| C | 1080 by 1920 | 37.0 s | 108 | 1.35 |
| D (target appliance) | 800 by 480 | 0.0 s | 56 | 1.15 |

Also compare each of the six atlas cells separately. Pixel-perfect atlas cells are expected when the browser canvas implementation uses the same stroke rasterization. Cross-engine rasterizers may differ at antialiased edges, but tree topology, primitive transforms, and ring placement must coincide.

For the complete scene, inspect both a pixel diff and these perceptual invariants:

- the same major sigils occupy the same coordinates and have the same silhouettes;
- ring counts, radii, dash frequencies, axis angles, node orbits, and rotation directions match;
- the horizon structure has five continuous horizontal lines plus repeating glyphs, ticks, notches, and intermittent rungs;
- marks retain a stable 4 by 4 ordered texture without random sparkle;
- the starfield remains subordinate to the geometry;
- cyan is concentrated at the horizon, while sigils move among crimson, violet, cyan, and small gold accents;
- edges fall toward neutral near-black under the vignette.
