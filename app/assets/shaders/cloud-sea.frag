// Independent interpretation of mdb's "up in the cloud sea" (Ndc3zl).
// Air perspective, layered parallax and a small railway. No reference code/assets copied.
precision highp float;
uniform vec2 uResolution;
uniform vec2 uPointer;
uniform float uTime;
uniform float uZoom;
uniform float uTravel;
uniform float uDetail;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uLight;
uniform vec3 uShade;
uniform vec3 uDeep;
uniform vec3 uRail;
uniform sampler2D uTrainArt;
uniform sampler2D uNoise;
uniform float uNoiseTexel;
uniform vec4 uTrainBounds; // Left edge, rail height, carriage pitch, carriage count.

float noise(vec2 p) {
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return texture2D(uNoise, (floor(p) + f + 0.5) * uNoiseTexel).r;
}
float fogNoise(vec2 p) {
  float value = 0.0, amplitude = 0.52;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = mat2(1.76, -0.96, 0.96, 1.76) * p + 11.3;
    amplitude *= 0.46;
  }
  return value;
}
// The broad washes and the small broken marks share coordinates, so the marks
// belong to a cloud as it moves. Only the cloud banks need this fine detail.
vec2 cloudPigment(vec2 p, float detail) {
  float wash = 0.0, flecks = 0.0, weight = 1.0, total = 0.0, fineTotal = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= detail) break;
    float ink = noise(p);
    wash += ink * weight;
    total += weight;
    if (i >= 3) {
      flecks += ink * weight;
      fineTotal += weight;
    }
    p = mat2(1.89, -0.94, 0.94, 1.89) * p + vec2(13.7, 7.1);
    weight *= 0.66;
  }
  return vec2(wash / total, flecks / fineTotal);
}

vec3 bank(vec3 backdrop, vec2 p, float base, float seed, float depth, float haze, float softness, bool sunlitShelf) {
  vec2 q = p + uPointer * vec2(0.025, -0.012) * depth;
  q.x += uTime * 0.015 * depth;
  float altitude = q.y - base;
  float envelope = max(altitude * 1.08, -altitude * 1.48);
  const float cutoff = 0.34;
  float edgeWidth = max(softness, 3.5 / uResolution.y);
  if (1.0 - envelope < cutoff - edgeWidth) return backdrop;

  // Larger, longer faces in the sunward bank leave room for the torn edges to read.
  vec2 plane = q * (sunlitShelf ? vec2(1.32, 2.45) : vec2(2.15, 2.96)) + seed;
  // Bend the edges into large lobes before laying in the chipped paint.
  plane += 0.32 * (vec2(noise(plane * 1.24), noise(plane.yx * 1.31 + 9.0)) - 0.5);
  float nearMist = smoothstep(1.0, 2.5, depth);
  vec2 ink = cloudPigment(plane, mix(uDetail, 4.0, nearMist));
  float body = ink.x - envelope - cutoff;
  if (body < -edgeWidth) return backdrop;
  float coverage = smoothstep(-edgeWidth, edgeWidth, body);

  // Broad, lit tops over cool undercuts. A second, offset field breaks the
  // internal paint boundaries without covering the flat faces in grain.
  float folds = noise(plane * 1.12 + vec2(2.1, -4.8)) - 0.5;
  float tone = altitude * 1.28 + (ink.x - 0.5) * 0.56 + folds * 0.23;
  tone += (ink.y - 0.5) * mix(0.16, 0.035, nearMist);
  vec3 penumbra = mix(uDeep, uRail, sunlitShelf ? 0.08 : 0.46);
  vec3 halftone = mix(uShade, uLight, sunlitShelf ? 0.27 : 0.0);
  vec3 silver = mix(halftone, uLight, 0.46);
  float stroke = max(3.0 / uResolution.y, mix(0.005, 0.13, nearMist));
  vec3 cloud = mix(penumbra, uDeep, smoothstep(-0.11 - stroke, -0.11 + stroke, tone));
  cloud = mix(cloud, halftone, smoothstep(-0.018 - stroke, -0.018 + stroke, tone));
  cloud = mix(cloud, silver, smoothstep(0.072 - stroke, 0.072 + stroke, tone));
  cloud = mix(cloud, uLight, smoothstep(0.17 - stroke, 0.17 + stroke, tone));
  return mix(backdrop, mix(cloud, uSkyHorizon, haze), coverage);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
  p = (p - vec2(0.0, 0.40)) / (1.0 + uZoom) + vec2(0.0, 0.40);
  vec3 sky = mix(uSkyHorizon, uSkyTop, smoothstep(0.10, 0.90, p.y));
  float glow = exp(-length((p - vec2(0.38, 0.62)) * vec2(1.0, 1.5)) * 3.8);
  vec3 color = mix(sky, uLight, glow * 0.24);
  float highWisp = noise(vec2(p.x * 1.3 + uTime * 0.003, p.y * 15.0 + p.x * 0.9));
  color = mix(color, uSkyHorizon, smoothstep(0.52, 0.94, highWisp) * 0.13);

  color = bank(color, p, 0.75, 2.6, 0.22, 0.29, 0.005, false);
  color = bank(color, p, 0.52, 8.3, 0.48, 0.14, 0.004, true);
  color = bank(color, p, 0.30, 14.7, 0.80, 0.08, 0.004, false);

  // The home camera watches from afar. On explore, the same train is framed by its
  // native link bounds. Only the link lettering is above the weather.
  bool boarding = uTrainBounds.z > 0.0;
  vec2 b = boarding ? vec2((uv.x - 0.5) * aspect, uv.y) : p + uPointer * vec2(0.010, -0.006);
  float grade = 0.03492; // tan(2deg)
  float rail = boarding ? uTrainBounds.y + (b.x - uTrainBounds.x) * grade : 0.31 + b.x * grade;
  float x = b.x + uTime * 0.008;
  float span = fract((x + 0.18) / 1.23);
  float cableY = rail + 0.012 + 0.105 * pow(abs(span * 2.0 - 1.0), 2.0);
  float aa = 1.0 / uResolution.y;
  float deck = 1.0 - smoothstep(aa, 3.0 * aa, abs(b.y - rail + aa));
  float cable = 1.0 - smoothstep(0.0, 1.6 * aa, abs(b.y - cableY));
  float tower = (1.0 - smoothstep(0.0025, 0.0025 + aa, min(span, 1.0 - span))) * step(rail - 0.16, b.y) * step(b.y, rail + 0.124);
  float hanger = (1.0 - smoothstep(0.0003, 0.0003 + aa, abs(fract(span * 16.0 + 0.5) - 0.5) * 1.23 / 16.0))
    * step(rail, b.y) * step(b.y, cableY);
  float bridge = max(max(deck, tower), max(cable * 0.75, hanger * 0.52));
  color = mix(color, mix(uRail, uDeep, 0.15), bridge * 0.88);

  float pitch = boarding ? uTrainBounds.z : 0.060;
  float count = boarding ? uTrainBounds.w : 3.0;
  float left = boarding ? uTrainBounds.x : min(aspect * 0.22, 0.42) * sin(uTime * 0.04 + 0.9) - 2.5 * pitch;
  vec2 t = (b - vec2(left, rail)) / pitch;
  float behind = count + 0.64 - t.x;
  if (behind > -0.1 && behind < 2.7 && t.y > 0.32) {
    float width = 0.022 + max(0.0, behind) * 0.070;
    float swirls = noise(vec2(t.x * 3.4 + uTime * 0.6, t.y * 6.5)) - 0.45;
    float plume = t.y - 0.38 - 0.22 * sqrt(max(behind, 0.0)) - width * swirls;
    float steam = exp(-plume * plume / (width * width)) * smoothstep(-0.09, 0.04, behind) * (1.0 - smoothstep(0.15, 2.65, behind));
    color = mix(color, uLight, steam * 0.74);
  }
  if (t.x >= 0.0 && t.x < count + 1.0 && t.y >= 0.0 && t.y < 0.4375) {
    vec2 artUV = vec2((fract(t.x) + step(count, t.x)) * 0.5, 1.0 - t.y / 0.4375);
    vec4 art = texture2D(uTrainArt, artUV);
    color = mix(color, mix(art.rgb, uSkyHorizon, boarding ? 0.13 : 0.32), art.a);
  }

  // Wisps catch the wheels and drift unevenly across the windows, on the same
  // depth plane as the nearer bridge piers. Do not lower opacity on the links.
  // Even at maximum noise, the rail fog fades out within 0.26 scene units.
  if (b.y < rail + 0.26) {
    float eddies = fogNoise(vec2(b.x * 4.0 + uTime * 0.046, b.y * 6.0) + 19.3);
    float fogTop = rail + (eddies - 0.48) * 0.43;
    float veil = 1.0 - smoothstep(fogTop - 0.042, fogTop + 0.053, b.y);
    color = mix(color, mix(uShade, uLight, 0.67 + eddies * 0.25), veil * (0.22 + 0.48 * eddies));
  }

  // Foreground passes in front of bridge/train; broad soft edges provide the near focus plane.
  color = bank(color, p, 0.025, 21.2, 1.8, 0.07, 0.024, false);
  vec3 foreground = bank(color, p, -0.105, 33.8, 3.2, 0.08, 0.042, false);
  color = mix(color, foreground, 0.86 + uTravel * 0.10);
  float mistHeight = (p.y - 0.16) / 0.10;
  float mist = exp(-mistHeight * mistHeight) * 0.12;
  color = mix(color, uLight, mist);
  // Shade only the title and stats areas; keep the centre of the cloud painting in full light.
  float sides = 1.0 - smoothstep(0.18, 0.42, min(uv.x, 1.0 - uv.x));
  float opening = boarding ? sides : 1.0 - smoothstep(0.20, 0.72, uv.x);
  if (aspect < 1.25) opening = 1.0;
  opening *= boarding ? (1.0 - smoothstep(0.07, 0.30, abs(uv.y - 0.77))) : smoothstep(0.50, 0.75, uv.y);
  // Darken the painted sky behind the type, preserving the differences between pigment bands.
  vec3 inkShadow = mix(color * 0.50, uRail, 0.35);
  color = mix(color, inkShadow, opening * 0.86);
  gl_FragColor = vec4(color, 1.0);
}
