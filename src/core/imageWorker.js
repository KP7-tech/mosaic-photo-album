import { rgbToLab } from './colorSpace.js';

self.onmessage = async (e) => {
  const { type, payload } = e.data;
  
  if (type === 'PROCESS_FILES') {
    const { files } = payload; // expected: [{ id: 1, file: FileObj }, ...]
    
    for (const item of files) {
      try {
        const { id, file } = item;
        // high efficiency image decoding
        const bitmap = await self.createImageBitmap(file);
        
        // 5x5 sampling
        const w = 5;
        const h = 5;
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0, w, h);
        
        const imageData = ctx.getImageData(0, 0, w, h).data;
        let r = 0, g = 0, b = 0, count = 0;
        for(let i = 0; i < imageData.length; i += 4) {
          r += imageData[i];
          g += imageData[i+1];
          b += imageData[i+2];
          count++;
        }
        
        if (count > 0) {
          r = Math.round(r / count);
          g = Math.round(g / count);
          b = Math.round(b / count);
        }
        
        const lab = rgbToLab(r, g, b);
        
        // Convert to compressed Blob -> DataURL for thumbnail usage
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.5 });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        
        await new Promise((resolve, reject) => {
          reader.onloadend = () => {
            self.postMessage({
              type: 'FILE_PROCESSED',
              payload: { id, lab, dataUrl: reader.result }
            });
            resolve();
          };
          reader.onerror = reject;
        });

        bitmap.close(); // free memory
      } catch (err) {
        console.error('Worker error processing file', item.id, err);
      }
    }
    
    self.postMessage({ type: 'ALL_PROCESSED' });
  }
};
