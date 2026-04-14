// src/core/colorSpace.js

/**
 * Converts RGB [0-255] to CIELAB space.
 * @param {number} r 
 * @param {number} g 
 * @param {number} b 
 * @returns {number[]} [L, A, B]
 */
export function rgbToLab(r, g, b) {
  let r_l = r / 255.0;
  let g_l = g / 255.0;
  let b_l = b / 255.0;

  r_l = (r_l > 0.04045) ? Math.pow((r_l + 0.055) / 1.055, 2.4) : (r_l / 12.92);
  g_l = (g_l > 0.04045) ? Math.pow((g_l + 0.055) / 1.055, 2.4) : (g_l / 12.92);
  b_l = (b_l > 0.04045) ? Math.pow((b_l + 0.055) / 1.055, 2.4) : (b_l / 12.92);

  r_l *= 100.0;
  g_l *= 100.0;
  b_l *= 100.0;

  // Observer. = 2°, Illuminant = D65
  const x = r_l * 0.4124 + g_l * 0.3576 + b_l * 0.1805;
  const y = r_l * 0.2126 + g_l * 0.7152 + b_l * 0.0722;
  const z = r_l * 0.0193 + g_l * 0.1192 + b_l * 0.9505;

  let x_n = x / 95.047;
  let y_n = y / 100.000;
  let z_n = z / 108.883;

  x_n = (x_n > 0.008856) ? Math.pow(x_n, 1.0/3.0) : (7.787 * x_n) + (16.0 / 116.0);
  y_n = (y_n > 0.008856) ? Math.pow(y_n, 1.0/3.0) : (7.787 * y_n) + (16.0 / 116.0);
  z_n = (z_n > 0.008856) ? Math.pow(z_n, 1.0/3.0) : (7.787 * z_n) + (16.0 / 116.0);

  const L = (116.0 * y_n) - 16.0;
  const a = 500.0 * (x_n - y_n);
  const b_n = 200.0 * (y_n - z_n);

  return [L, a, b_n];
}

/**
 * Computes Delta E (CIEDE2000 or simple euclidean distance).
 * For performance in real-time we use Delta E 76 (Euclidean) as it is extremely fast and good enough for gaming.
 * @param {number[]} lab1 
 * @param {number[]} lab2 
 * @returns {number} delta E
 */
export function deltaE76(lab1, lab2) {
  const dL = lab1[0] - lab2[0];
  const da = lab1[1] - lab2[1];
  const db = lab1[2] - lab2[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}
