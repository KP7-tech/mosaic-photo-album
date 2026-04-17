import React, { useState, useEffect } from 'react';
import './App.css';
import ColorHunter from './components/ColorHunter';
import MosaicCanvas from './components/MosaicCanvas';
import { KDTree } from './core/kdTree';
import { readImage, extractDominantColor, sliceBlueprint } from './core/imageProcessor';
import { db, addPhoto, clearPhotos, incrementPhotoUsage } from './db/database';
import { useRef } from 'react';

function App() {
  const [activeTab, setActiveTab] = useState('setup'); // 'setup' | 'mosaic' | 'hunter'
  const [pieces, setPieces] = useState([]);
  const [targetPiece, setTargetPiece] = useState(null);
  const [canvasSize, setCanvasSize] = useState({ w: 300, h: 300 });
  const [isProcessing, setIsProcessing] = useState(false);
  
  const albumInputRef = useRef(null);
  const blueprintInputRef = useRef(null);

  const handleAlbumUpload = async (e) => {
    const files = e.target.files;
    if(!files.length) return;
    setIsProcessing(true);
    
    // Batch processing
    const fileArray = Array.from(files);
    const chunkSize = 10;
    for(let i=0; i<fileArray.length; i+=chunkSize) {
        const chunk = fileArray.slice(i, i+chunkSize);
        await Promise.all(chunk.map(async file => {
            const img = await readImage(file);
            const { lab, dataUrl } = extractDominantColor(img);
            if(dataUrl) {
                await addPhoto(lab, dataUrl);
            }
        }));
    }
    
    setIsProcessing(false);
    alert(`已匯入 ${files.length} 張照片至相簿`);
  };

  const handleBlueprintUpload = async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    setIsProcessing(true);
    
    // 1. Process blueprint into pieces
    const img = await readImage(file);
    const { pieces: newPieces, width, height } = sliceBlueprint(img, 30, 30); // 30x30 grid
    setCanvasSize({ w: width, h: height });

    // 2. Fetch all photos from album
    const photos = await db.photos.toArray();
    
    // 3. Build KDTree if we have photos
    let tree = null;
    if(photos.length > 0) {
        tree = new KDTree(photos, ['L', 'a', 'b']);
    }

    // 4. Assign photos
    const THRESHOLD = 15.0; // Delta E threshold
    for(let piece of newPieces) {
        let assigned = false;
        if(tree) {
            const point = { L: piece.targetLAB[0], a: piece.targetLAB[1], b: piece.targetLAB[2] };
            const best = tree.nearest(point, 1);
            if(best.length > 0 && best[0].distance < THRESHOLD) {
                piece.state = 'filled';
                piece.assignedPhotoUrl = best[0].node.obj.url;
                assigned = true;
                await incrementPhotoUsage(best[0].node.obj.id);
            }
        }
        if(!assigned) {
            piece.state = 'missing';
        }
    }

    setPieces(newPieces);
    setActiveTab('mosaic');
    setIsProcessing(false);
  };

  const handlePieceClick = (piece) => {
    if(piece.state === 'missing') {
      setTargetPiece(piece);
      setActiveTab('hunter');
    }
  };

  const handleCapture = async (capturedData) => {
    // compatibility with old LAB purely return or new capture return
    const lab = capturedData.lab || capturedData;
    const dataUrl = capturedData.dataUrl || null;
    
    if(dataUrl) {
      await addPhoto(lab, dataUrl);
    }
    
    alert('成功提取現實色彩！填入拼圖！');
    
    setPieces(prev => prev.map(p => {
      if(p.id === targetPiece.id) {
        return {
          ...p,
          state: 'filled',
          targetRGB: [128, 128, 128],
          assignedPhotoUrl: dataUrl
        };
      }
      return p;
    }));
    
    setTargetPiece(null);
    setActiveTab('mosaic');
  };

  return (
    <div className="App">
      <header className="header">
        <h1>Mosaic Alchemist</h1>
        <div className="tabs">
          <button 
            className={activeTab === 'setup' ? 'active' : ''} 
            onClick={() => setActiveTab('setup')}
          >
            設定區
          </button>
          <button 
            className={(activeTab === 'mosaic' && !isProcessing) ? 'active' : ''} 
            onClick={() => { if(pieces.length > 0) setActiveTab('mosaic') }}
            disabled={pieces.length === 0}
          >
            我的藝術品
          </button>
          <button 
            className={activeTab === 'hunter' ? 'active' : ''} 
            onClick={() => { if(targetPiece) setActiveTab('hunter') }}
            disabled={!targetPiece}
          >
            色彩獵人
          </button>
        </div>
      </header>

      <main className="main-content">
        {isProcessing && <div style={{color: 'white', padding: '20px'}}>處理中，請稍候...</div>}

        {!isProcessing && activeTab === 'setup' && (
          <div className="setup-view" style={{ padding: '20px', color: 'white', textAlign: 'left' }}>
            <h2>1. 建立相簿 (掃描照片)</h2>
            <p style={{marginBottom: '16px'}}>請選擇你本機的圖片作為色彩庫來源：</p>
            
            <input 
              type="file" 
              multiple 
              accept="image/*" 
              onChange={handleAlbumUpload} 
              ref={albumInputRef}
              style={{ display: 'none' }} 
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <button className="btn-primary" onClick={() => albumInputRef.current.click()}>
                選擇照片檔案
              </button>
              <button className="btn-secondary" onClick={async () => { await clearPhotos(); alert('相簿已清空'); }}>
                清空現有相簿
              </button>
            </div>

            <hr style={{margin: '40px 0', borderColor: 'rgba(255,255,255,0.1)'}} />

            <h2>2. 選擇目標畫布 (Blueprint)</h2>
            <p style={{marginBottom: '16px'}}>請選擇一張你想拼成的圖片：</p>
            
            <input 
              type="file" 
              accept="image/*" 
              onChange={handleBlueprintUpload} 
              ref={blueprintInputRef}
              style={{ display: 'none' }} 
            />
            <button className="btn-primary" onClick={() => blueprintInputRef.current.click()}>
              選擇畫布檔案
            </button>
          </div>
        )}

        {!isProcessing && activeTab === 'mosaic' && (
          <div className="mosaic-view">
            <p className="subtitle">請點擊畫布上的缺口塊 (Missing Pieces) 進行尋色</p>
            <div className="canvas-wrapper">
              <MosaicCanvas pieces={pieces} width={canvasSize.w} height={canvasSize.h} />
              
              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
                {pieces.map(p => (
                  <div
                    key={p.id}
                    onClick={() => handlePieceClick(p)}
                    style={{
                      position: 'absolute',
                      left: `${(p.x / canvasSize.w) * 100}%`,
                      top: `${(p.y / canvasSize.h) * 100}%`,
                      width: `${(p.w / canvasSize.w) * 100}%`,
                      height: `${(p.h / canvasSize.h) * 100}%`,
                      cursor: p.state === 'missing' ? 'pointer' : 'default',
                      border: p.state === 'missing' ? '1px dashed rgba(255,255,255,0.5)' : 'none',
                      backgroundColor: p.state === 'missing' && p.id === targetPiece?.id ? 'rgba(255, 255, 255, 0.3)' : 'transparent',
                      pointerEvents: p.state === 'missing' ? 'auto' : 'none'
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {!isProcessing && activeTab === 'hunter' && (
          <ColorHunter 
            targetPiece={targetPiece} 
            onCapture={handleCapture}
          />
        )}
      </main>
    </div>
  );
}

export default App;
