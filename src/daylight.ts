// Daylight (an Easter egg, see Info & feedback): a sky tint at the top of the window and card shadows that follow the
// real sun and moon. A soft ambient shade is always there; the long sun or moon shadow fades in and out on top, and
// dawn and dusk crossfade into night blue and moonlight (brightness by moon phase). Recomputed once a minute.

const RAD = Math.PI / 180;
const LATITUDE = 48; // central Europe; the longitude comes from the time zone (see sunMoon)

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
/** 0 below a, 1 above b, eased in between. */
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const elevation = (hourAngle: number, declination: number) =>
  Math.asin(Math.sin(LATITUDE * RAD) * Math.sin(declination * RAD) + Math.cos(LATITUDE * RAD) * Math.cos(declination * RAD) * Math.cos(hourAngle * RAD)) / RAD;

/** Where the moon is in its cycle: 0 new, 0.5 full (from a known new moon, mean synodic month). */
export function moonPhase(date: Date): number {
  const synodic = 29.530588853;
  const days = (date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86_400_000;
  return (((days % synodic) + synodic) % synodic) / synodic;
}

/**
 * Sun and moon for a moment, in degrees: elevations and hour angles (−: east/morning, +: west/evening), plus how much of
 * the moon is lit (0–1). Solar noon is taken at 12:00 standard time of the local time zone (13:00 in summer time). The
 * moon trails the sun by its phase (a full moon is opposite the sun), which is close enough for a picture.
 */
export function sunMoon(date: Date) {
  const start = new Date(date.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86_400_000) + 1;
  const declination = 23.44 * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81));
  const standard = Math.max(start.getTimezoneOffset(), new Date(date.getFullYear(), 6, 1).getTimezoneOffset());
  const minutes = date.getHours() * 60 + date.getMinutes() - (standard - date.getTimezoneOffset());
  const sunHour = (minutes / 60 - 12) * 15;
  const phase = moonPhase(date);
  const moonHour = ((sunHour - phase * 360 + 540) % 360) - 180;
  return {
    sun: { elevation: elevation(sunHour, declination), hourAngle: sunHour },
    moon: { elevation: elevation(moonHour, declination * Math.cos(phase * 2 * Math.PI)), hourAngle: moonHour },
    lit: (1 - Math.cos(phase * 2 * Math.PI)) / 2,
    phase,
  };
}

/** Sky colour by sun elevation: night violet → dawn pink → morning gold → noon pale warm white. */
const SKY: [number, number[]][] = [
  [-8, [90, 90, 170]],
  [-3, [150, 120, 190]],
  [2, [250, 150, 140]],
  [10, [255, 200, 150]],
  [30, [255, 236, 190]],
  [60, [255, 246, 220]],
];
function skyColour(e: number): string {
  if (e <= SKY[0][0]) return SKY[0][1].join(',');
  for (let i = 0; i < SKY.length - 1; i++) {
    const [a, ca] = SKY[i];
    const [b, cb] = SKY[i + 1];
    if (e <= b) return ca.map((v, j) => Math.round(v + (cb[j] - v) * clamp((e - a) / (b - a)))).join(',');
  }
  return SKY[SKY.length - 1][1].join(',');
}
/** Left (east) to right (west) across the window. */
const xOf = (hourAngle: number) => clamp(50 + hourAngle / 1.6, 5, 95);

/** A long shadow: layered copies stepping away from the light and fading out. */
function longShadow(hourAngle: number, e: number, rgb: string, strength: number, scale = 1, steps = 18): string[] {
  if (strength < 0.003) return [];
  const len = Math.min(60, 6 / Math.tan(Math.max(4, e) * RAD)) * scale;
  const dx = -Math.sin(hourAngle * RAD) * len;
  const dy = Math.max(2, len * 0.35);
  return Array.from({ length: steps }, (_, i) => {
    const f = (i + 1) / steps;
    return `${(dx * f).toFixed(1)}px ${(dy * f).toFixed(1)}px 0 rgba(${rgb},${(strength * (1 - f)).toFixed(3)})`;
  });
}

export type DaylightLook = { sky: string; shadow: string; textShadow: string };

export function daylight(date: Date, dark: boolean): DaylightLook {
  const { sun, moon, lit } = sunMoon(date);
  const day = smooth(-8, 1, sun.elevation);
  const night = 1 - smooth(-10, -2, sun.elevation);
  const layers: string[] = [];
  if (day > 0) {
    const a = (dark ? 0.2 : 0.32) * day;
    const c = skyColour(sun.elevation);
    layers.push(`radial-gradient(120% 100% at ${xOf(sun.hourAngle)}% -30%, rgba(${c},${a.toFixed(3)}) 0%, rgba(${c},${(a * 0.45).toFixed(3)}) 45%, transparent 75%)`);
  }
  const moonlight = night * smooth(-2, 8, moon.elevation) * lit;
  if (moonlight > 0.01) {
    const a = (dark ? 0.18 : 0.22) * moonlight;
    layers.push(`radial-gradient(90% 90% at ${xOf(moon.hourAngle)}% -25%, rgba(200,215,255,${a.toFixed(3)}) 0%, rgba(160,180,240,${(a * 0.4).toFixed(3)}) 45%, transparent 75%)`);
  }
  if (night > 0) layers.push(`linear-gradient(rgba(30,40,95,${((dark ? 0.22 : 0.12) * night).toFixed(3)}), transparent 80%)`);

  // Soft shade from the sky, always on; the long shadow of the sun or the moon on top.
  const shade = dark ? '0,0,0' : '60,45,30';
  const ambient = `0 ${(2 + 2 * day).toFixed(1)}px ${(10 + 6 * day).toFixed(0)}px rgba(${shade},${((dark ? 0.32 : 0.05) + (dark ? 0.1 : 0.03) * day).toFixed(3)})`;
  const sunStrength = smooth(-1, 8, sun.elevation) * (dark ? 0.5 : 0.09 * Math.min(1, 10 / Math.max(sun.elevation, 4)) + 0.03);
  const moonStrength = night * smooth(0, 10, moon.elevation) * lit * (dark ? 0.42 : 0.09);
  const bySun = sunStrength >= moonStrength;
  const source = bySun ? sun : moon;
  const rgb = bySun ? (dark ? '0,0,0' : '70,45,15') : dark ? '0,0,20' : '30,40,90';
  const strength = bySun ? sunStrength : moonStrength;
  const long = longShadow(source.hourAngle, Math.max(source.elevation, 0.5), rgb, strength);
  const text = longShadow(source.hourAngle, Math.max(source.elevation, 0.5), rgb, strength * 1.2, 0.35, 10);
  return { sky: layers.join(',') || 'none', shadow: [ambient, ...long].join(','), textShadow: text.join(',') || 'none' };
}

