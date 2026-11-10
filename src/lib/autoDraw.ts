// Auto-path drawings for pit scouting. A drawing is a list of strokes; each stroke
// is a flat [x, y, x, y, …] list of whole numbers on a 0–1000 grid laid over the
// square field image, so it redraws identically at any size. Stored as JSON (a
// few KB) instead of an image (hundreds of KB). Validated in convex/pit.ts.

export type Stroke = number[];

/** The field picture every drawing sits on. */
export const FIELD_IMAGE = "/fields/biobuzz.webp";
export const GRID = 1000;
/** Pen width in grid units (about 6px on a 375px-wide phone drawing). */
export const STROKE_WIDTH = 14;

export function encodeStrokes(strokes: Stroke[]): string {
  return JSON.stringify(strokes);
}

export function decodeStrokes(json: string | undefined | null): Stroke[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((s): s is Stroke => Array.isArray(s) && s.length >= 2) : [];
  } catch {
    return [];
  }
}

/** SVG path data for one stroke (a lone point draws as a dot via round caps). */
export function strokePath(s: Stroke): string {
  let d = `M${s[0]} ${s[1]}`;
  if (s.length === 2) return `${d} L${s[0]} ${s[1]}`;
  for (let i = 2; i < s.length; i += 2) d += ` L${s[i]} ${s[i + 1]}`;
  return d;
}

const clamp = (x: number) => Math.max(0, Math.min(GRID, Math.round(x)));

/**
 * Ramer–Douglas–Peucker: drop points within `eps` grid units of the segment between
 * their neighbours (the segment, not the infinite line, so a path that drives out
 * and back or loops to its start survives), then round to whole numbers. A finger stroke of ~200 raw
 * points usually keeps 10–40, which is what keeps drawings to a few KB.
 */
export function simplify(points: [number, number][], eps = 2.5): Stroke {
  if (points.length <= 2) return points.flatMap(([x, y]) => [clamp(x), clamp(y)]);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = segDist(px, py, ax, ay, bx, by);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > eps) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out: Stroke = [];
  points.forEach(([x, y], i) => {
    if (keep[i]) out.push(clamp(x), clamp(y));
  });
  return out;
}

/** Distance from (px, py) to the segment (ax, ay)–(bx, by). */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Index of the first stroke passing within `radius` of (x, y), or -1. */
export function hitStroke(strokes: Stroke[], x: number, y: number, radius: number): number {
  for (let k = 0; k < strokes.length; k++) {
    const s = strokes[k];
    if (s.length === 2) {
      if (Math.hypot(x - s[0], y - s[1]) <= radius) return k;
      continue;
    }
    for (let i = 0; i + 3 < s.length; i += 2) {
      if (segDist(x, y, s[i], s[i + 1], s[i + 2], s[i + 3]) <= radius) return k;
    }
  }
  return -1;
}

/**
 * Shrink a photo on the phone before upload: longest side `maxSide` px, JPEG.
 * A 12 MP phone photo (3–5 MB) becomes roughly 100–300 KB.
 */
export async function compressPhoto(file: File, maxSide = 1280, quality = 0.75): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process that photo."))), "image/jpeg", quality),
  );
}
