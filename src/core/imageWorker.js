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
        
        // --- Step 1: 5x5 sampling for LAB color matching (unchanged) ---
        const sampleCanvas = new OffscreenCanvas(5, 5);
        const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
        sampleCtx.drawImage(bitmap, 0, 0, 5, 5);
        
        const imageData = sampleCtx.getImageData(0, 0, 5, 5).data;
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
        
        // --- Step 2: 256px display thumbnail (high quality) ---
        const THUMB_SIZE = 256;
        const scale = Math.min(THUMB_SIZE / bitmap.width, THUMB_SIZE / bitmap.height, 1);
        const tw = Math.round(bitmap.width * scale);
        const th = Math.round(bitmap.height * scale);
        const thumbCanvas = new OffscreenCanvas(tw, th);
        const thumbCtx = thumbCanvas.getContext('2d');
        thumbCtx.drawImage(bitmap, 0, 0, tw, th);
        
        const thumbBlob = await thumbCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        const reader = new FileReader();
        reader.readAsDataURL(thumbBlob);
        
        await new Promise((resolve, reject) => {
          reader.onloadend = () => {
            self.postMessage({
              type: 'FILE_PROCESSED',
              payload: { id, lab, dataUrl: reader.result } // dataUrl is now the 256px thumb
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
