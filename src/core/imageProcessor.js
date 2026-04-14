// src/core/imageProcessor.js
import { rgbToLab } from './colorSpace.js';

export function readImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export function extractDominantColor(img) {
  const canvas = document.createElement('canvas');
  // keep size small for performance
  const MAX_SIZE = 50;
  let w = img.width;
  let h = img.height;
  if(w > MAX_SIZE || h > MAX_SIZE) {
    const ratio = Math.min(MAX_SIZE / w, MAX_SIZE / h);
    w = Math.floor(w * ratio);
    h = Math.floor(h * ratio);
  }
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  
  const data = ctx.getImageData(0, 0, w, h).data;
  let r = 0, g = 0, b = 0, count = 0;
  for(let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i+1];
    b += data[i+2];
    count++;
  }
  if(count === 0) return { r:0, g:0, b:0, lab: [0,0,0], dataUrl: '' };
  
  const avgR = Math.round(r / count);
  const avgG = Math.round(g / count);
  const avgB = Math.round(b / count);
  const lab = rgbToLab(avgR, avgG, avgB);
  
  // Create a tiny data URL for the thumbnail
  return { 
    r: avgR, g: avgG, b: avgB, 
    lab, 
    dataUrl: canvas.toDataURL('image/jpeg', 0.5) 
  };
}

export function sliceBlueprint(img, cols = 20, rows = 20) {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, img.width, img.height);
  
  const tileW = Math.floor(img.width / cols);
  const tileH = Math.floor(img.height / rows);
  
  const pieces = [];
  for(let y = 0; y < rows; y++) {
    for(let x = 0; x < cols; x++) {
      const sx = x * tileW;
      const sy = y * tileH;
      const data = ctx.getImageData(sx, sy, tileW, tileH).data;
      let r = 0, g = 0, b = 0, count = 0;
      // Skip pixels for speed (e.g. read every 16th byte = 4th pixel)
      for(let i = 0; i < data.length; i += 16) {
        r += data[i];
        g += data[i+1];
        b += data[i+2];
        count++;
      }
      const avgR = count > 0 ? Math.round(r / count) : 0;
      const avgG = count > 0 ? Math.round(g / count) : 0;
      const avgB = count > 0 ? Math.round(b / count) : 0;
      
      pieces.push({
        id: `${x}-${y}`,
        x: sx,
        y: sy,
        w: tileW,
        h: tileH,
        targetRGB: [avgR, avgG, avgB],
        targetLAB: rgbToLab(avgR, avgG, avgB),
        state: 'missing', // will be evaluated later
        assignedPhotoUrl: null
      });
    }
  }
  
  return { pieces, width: img.width, height: img.height };
}
