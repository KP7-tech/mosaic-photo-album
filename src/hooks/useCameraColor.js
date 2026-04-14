// src/hooks/useCameraColor.js
import { useState, useEffect, useRef } from 'react';
import { rgbToLab, deltaE76 } from '../core/colorSpace.js';

export function useCameraColor(targetLAB, active = true) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  const [currentLAB, setCurrentLAB] = useState(null);
  const [distance, setDistance] = useState(null);
  const [status, setStatus] = useState('initializing'); // initializing, searching, approaching, locked
  
  useEffect(() => {
    if (!active) return;
    
    let animationFrameId;
    let stream;
    let frameCount = 0;
    
    async function setupCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // IMPORTANT: Wait for video to be ready before processing
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play();
            setStatus('searching');
            processFrame();
          };
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
        setStatus('error');
      }
    }
    
    function processFrame() {
      if (!videoRef.current || !canvasRef.current) return;
      
      // Throttle: Process every 6 frames to save battery (equivalent to ~10 fps)
      frameCount++;
      if (frameCount % 6 === 0) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        // Ensure canvas matches video size
        if (canvas.width !== video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        
        if (canvas.width === 0) {
           animationFrameId = requestAnimationFrame(processFrame);
           return;
        }

        // Draw current frame to canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Extract center 20x20 pixels
        const size = 20;
        const cx = Math.floor(canvas.width / 2) - size / 2;
        const cy = Math.floor(canvas.height / 2) - size / 2;
        
        const imageData = ctx.getImageData(cx, cy, size, size);
        const data = imageData.data;
        
        let rSum = 0, gSum = 0, bSum = 0;
        const pixelCount = size * size;
        
        for (let i = 0; i < data.length; i += 4) {
          rSum += data[i];
          gSum += data[i + 1];
          bSum += data[i + 2];
        }
        
        const avgR = rSum / pixelCount;
        const avgG = gSum / pixelCount;
        const avgB = bSum / pixelCount;
        
        const lab = rgbToLab(avgR, avgG, avgB);
        setCurrentLAB(lab);
        
        if (targetLAB) {
          const dist = deltaE76(lab, targetLAB);
          setDistance(dist);
          
          // Custom tolerance threshold logic
          let toleranceBump = (targetLAB[0] < 15 || targetLAB[0] > 85) ? 3.0 : 0.0;
          
          if (dist < (5.0 + toleranceBump)) {
            setStatus('locked');
            // Trigger haptic feedback if browser supports it
            if (navigator.vibrate) navigator.vibrate(50);
          } else if (dist < 10.0 + toleranceBump) {
            setStatus('approaching');
          } else {
            setStatus('searching');
          }
        }
      }
      
      animationFrameId = requestAnimationFrame(processFrame);
    }
    
    setupCamera();
    
    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [active, targetLAB]);
  
  return { videoRef, canvasRef, currentLAB, distance, status };
}
