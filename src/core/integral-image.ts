// Summed-area tables for O(1) rectangular average queries.

export type IntegralChannel = {
  data: Float32Array;
  width: number;
  height: number;
};

export type IntegralImage = {
  luminance: IntegralChannel;
  red?: IntegralChannel;
  green?: IntegralChannel;
  blue?: IntegralChannel;
  width: number;
  height: number;
};

export function buildIntegralImage(img: ImageData, includeColor: boolean): IntegralImage {
  const { width: w, height: h, data } = img;
  const lum = buildChannel(w, h, (i) =>
    (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255,
  );
  if (!includeColor) {
    return { luminance: lum, width: w, height: h };
  }
  return {
    luminance: lum,
    red: buildChannel(w, h, (i) => data[i] / 255),
    green: buildChannel(w, h, (i) => data[i + 1] / 255),
    blue: buildChannel(w, h, (i) => data[i + 2] / 255),
    width: w,
    height: h,
  };
}

function buildChannel(w: number, h: number, sample: (i: number) => number): IntegralChannel {
  const W = w + 1;
  const H = h + 1;
  const I = new Float32Array(W * H);
  for (let y = 1; y < H; y++) {
    let rowSum = 0;
    for (let x = 1; x < W; x++) {
      rowSum += sample(((y - 1) * w + (x - 1)) * 4);
      I[y * W + x] = rowSum + I[(y - 1) * W + x];
    }
  }
  return { data: I, width: w, height: h };
}

export function averageOver(
  ch: IntegralChannel,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const w = ch.width;
  const h = ch.height;
  const ax = Math.max(0, Math.floor(x0));
  const ay = Math.max(0, Math.floor(y0));
  const bx = Math.min(w, Math.ceil(x1));
  const by = Math.min(h, Math.ceil(y1));
  if (bx <= ax || by <= ay) return 0.5;
  const W = w + 1;
  const I = ch.data;
  const sum = I[by * W + bx] - I[ay * W + bx] - I[by * W + ax] + I[ay * W + ax];
  return sum / ((bx - ax) * (by - ay));
}
