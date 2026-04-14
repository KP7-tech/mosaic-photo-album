// src/components/ColorHunter.jsx
import React, { useState } from 'react';
import { useCameraColor } from '../hooks/useCameraColor.js';

export default function ColorHunter({ targetPiece, onCapture }) {
  // targetPiece: { targetLAB, targetRGB }
  const { videoRef, canvasRef, currentLAB, distance, status } = useCameraColor(
    targetPiece?.targetLAB,
    !!targetPiece
  );

  if (!targetPiece) {
    return <div className="color-hunter empty">請選擇一個缺少的拼圖塊來尋找顏色</div>;
  }

  const tRGB = targetPiece.targetRGB;
  const targetColorStr = `rgb(${tRGB[0]}, ${tRGB[1]}, ${tRGB[2]})`;

  const getBorderColor = () => {
    switch(status) {
      case 'locked': return '#4caf50'; // Green
      case 'approaching': return '#ffeb3b'; // Yellow
      case 'searching': return '#f44336'; // Red
      default: return '#fff';
    }
  };

  const statusText = {
    'locked': '精準捕捉！請按下快門',
    'approaching': '發現目標附近，再近一點！',
    'searching': '尋找目標色彩...',
    'initializing': '啟動相機中...',
    'error': '無法存取相機'
  }[status] || 'Unknown';

  return (
    <div className="color-hunter-container" style={styles.container}>
      <div style={styles.targetInfo}>
        <div style={{...styles.colorBlock, backgroundColor: targetColorStr}}></div>
        <div style={styles.infoText}>目標 Delta E: {distance ? distance.toFixed(1) : '-'}</div>
      </div>
      
      <div style={styles.cameraWrapper}>
        <video 
          ref={videoRef} 
          playsInline 
          muted 
          style={styles.video}
        />
        {/* Hidden canvas for processing */}
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        
        {/* Reticle / Viewfinder */}
        <div style={{
          ...styles.reticle,
          borderColor: getBorderColor(),
          transform: status === 'locked' ? 'scale(0.8)' : 'scale(1)'
        }}></div>
      </div>

      <div style={{...styles.statusBanner, color: getBorderColor()}}>
        {statusText}
      </div>

      <button 
        style={{...styles.captureBtn, opacity: status === 'locked' ? 1.0 : 0.5}}
        disabled={status !== 'locked'}
        onClick={() => {
           if(status === 'locked' && onCapture) {
             const v = videoRef.current;
             if(v) {
               const c = document.createElement('canvas');
               c.width = 50; 
               c.height = 50; // Keep it square or thumbnail size
               const ctx = c.getContext('2d');
               // Draw center square
               const minDim = Math.min(v.videoWidth, v.videoHeight);
               const sx = (v.videoWidth - minDim) / 2;
               const sy = (v.videoHeight - minDim) / 2;
               ctx.drawImage(v, sx, sy, minDim, minDim, 0, 0, c.width, c.height);
               const dataUrl = c.toDataURL('image/jpeg', 0.5);
               onCapture({ lab: currentLAB, dataUrl });
             } else {
               onCapture({ lab: currentLAB });
             }
           }
        }}
      >
        捕獲顏色
      </button>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    background: '#111',
    color: '#fff',
    padding: '20px',
    borderRadius: '16px',
    maxWidth: '400px',
    margin: '0 auto'
  },
  targetInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px'
  },
  colorBlock: {
    width: '40px',
    height: '40px',
    borderRadius: '8px',
    border: '2px solid rgba(255,255,255,0.2)'
  },
  infoText: {
    fontFamily: 'monospace',
    fontSize: '14px'
  },
  cameraWrapper: {
    position: 'relative',
    width: '300px',
    height: '300px',
    borderRadius: '24px',
    overflow: 'hidden',
    backgroundColor: '#000',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  reticle: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: '40px', // Matches the 20x20 + padding logic
    height: '40px',
    marginLeft: '-20px',
    marginTop: '-20px',
    border: '4px solid white',
    borderRadius: '8px',
    transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
    boxShadow: '0 0 10px rgba(0,0,0,0.5)'
  },
  statusBanner: {
    marginTop: '16px',
    fontWeight: 'bold',
    fontSize: '16px',
    transition: 'color 0.3s ease'
  },
  captureBtn: {
    marginTop: '20px',
    padding: '12px 32px',
    borderRadius: '30px',
    border: 'none',
    background: 'linear-gradient(135deg, #FF5733, #FF8C00)',
    color: 'white',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'opacity 0.2s',
    boxShadow: '0 4px 15px rgba(255, 87, 51, 0.4)'
  }
};
