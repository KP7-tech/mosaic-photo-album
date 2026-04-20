import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import ColorHunter from './components/ColorHunter';
import MosaicCanvas from './components/MosaicCanvas';
import LibraryView from './components/LibraryView';
import ArtworksGallery from './components/ArtworksGallery';
import { KDTree } from './core/kdTree';
import { readImage, sliceBlueprint, createThumb } from './core/imageProcessor';
import { db, getPendingPhotos, updatePhotoData, initDefaultGroup, getAllPhotosForIndex, bulkIncrementUsage } from './db/database';

function App() {
  const [activeTab, setActiveTab] = useState('library'); // 'library' | 'gallery' | 'mosaic' | 'hunter'
  const [pieces, setPieces] = useState([]);
  const [currentArtworkId, setCurrentArtworkId] = useState(null);
  const [targetPiece, setTargetPiece] = useState(null);
  const [canvasSize, setCanvasSize] = useState({ w: 300, h: 300 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [backgroundProgress, setBackgroundProgress] = useState(null);
  
  const workerRef = useRef(null);

  const startBackgroundProcessing = async () => {
    const pendingPhotos = await getPendingPhotos();
    if(pendingPhotos.length === 0) {
      setBackgroundProgress(null);
      return;
    }
    
    setBackgroundProgress({ total: pendingPhotos.length, completed: 0 });
    
    if(!workerRef.current) {
      workerRef.current = new Worker(new URL('./core/imageWorker.js', import.meta.url), { type: 'module' });
      workerRef.current.onmessage = async (e) => {
        const { type, payload } = e.data;
        if(type === 'FILE_PROCESSED') {
             await updatePhotoData(payload.id, payload.lab, payload.dataUrl);
             setBackgroundProgress(prev => prev ? { ...prev, completed: prev.completed + 1 } : null);
        } else if (type === 'ALL_PROCESSED') {
             setBackgroundProgress(null);
        }
      };
    }
    
    const payloadFiles = pendingPhotos.map(p => ({ id: p.id, file: p.file }));
    workerRef.current.postMessage({ type: 'PROCESS_FILES', payload: { files: payloadFiles } });
  };

  useEffect(() => {
    initDefaultGroup();
    startBackgroundProcessing();
    return () => {
      if(workerRef.current) {
        workerRef.current.terminate();
      }
    }
  }, []);

  const handleNewArtwork = async (file, targetGroupId) => {
    setIsProcessing(true);
    
    // 1. Process blueprint into pieces
    const img = await readImage(file);
    const { pieces: newPieces, width, height } = sliceBlueprint(img, 30, 30); // 30x30 grid
    
    // 2. Fetch fully processed photos from targeted group
    const photos = await getAllPhotosForIndex(targetGroupId);
    
    // 3. Build KDTree if we have photos
    let tree = null;
    if(photos.length > 0) {
        tree = new KDTree(photos, ['L', 'a', 'b']);
    }

    // 4. Assign photos
    const THRESHOLD = 15.0; // Delta E threshold
    const usageCounts = {};

    for(let piece of newPieces) {
        let assigned = false;
        if(tree) {
            const point = { L: piece.targetLAB[0], a: piece.targetLAB[1], b: piece.targetLAB[2] };
            const best = tree.nearest(point, 1);
            if(best.length > 0 && best[0].distance < THRESHOLD) {
                piece.state = 'filled';
                piece.assignedPhotoUrl = best[0].node.obj.url;
                assigned = true;
                
                const photoId = best[0].node.obj.id;
                usageCounts[photoId] = (usageCounts[photoId] || 0) + 1;
            }
        }
        if(!assigned) {
            piece.state = 'missing';
        }
    }

    if (Object.keys(usageCounts).length > 0) {
        await bulkIncrementUsage(usageCounts);
    }

    // 5. Create artwork record
    const thumbDataUrl = await createThumb(file);
    const artworkName = file.name || `專案 ${new Date().toLocaleDateString()}`;
    const missingCount = newPieces.filter(p => p.state === 'missing').length;
    const isCompleted = missingCount === 0;

    const artworkId = await db.artworks.add({
      name: artworkName,
      status: isCompleted ? 'completed' : 'in-progress',
      width,
      height,
      piecesCount: newPieces.length,
      thumbDataUrl,
      targetGroupId,
      timestamp: Date.now()
    });

    const dbPieces = newPieces.map(p => {
        const uniqueId = `${artworkId}_${p.id}`;
        p.id = uniqueId; // update the live state too
        return {
          ...p,
          artworkId
        }
    });
    await db.mosaicPieces.bulkAdd(dbPieces);

    setPieces(newPieces);
    setCanvasSize({ w: width, h: height });
    setCurrentArtworkId(artworkId);
    setActiveTab('mosaic');
    setIsProcessing(false);
  };

  const handleOpenArtwork = async (id) => {
    setIsProcessing(true);
    const artwork = await db.artworks.get(id);
    if(artwork) {
      const savedPieces = await db.mosaicPieces.where('artworkId').equals(id).toArray();
      setPieces(savedPieces);
      setCanvasSize({ w: artwork.width, h: artwork.height });
      setCurrentArtworkId(id);
      setActiveTab('mosaic');
    }
    setIsProcessing(false);
  };

  const handlePieceClick = (piece) => {
    if(piece.state === 'missing') {
      setTargetPiece(piece);
      setActiveTab('hunter');
    }
  };

  const handleCapture = async (capturedData) => {
    const lab = capturedData.lab || capturedData;
    const dataUrl = capturedData.dataUrl || null;
    let newPhotoId = null;
    
    if(dataUrl) {
      // Add to standard photos and explicitly set to target group to ensure it stays in the pool
      const artwork = await db.artworks.get(currentArtworkId);
      const groups = artwork && artwork.targetGroupId !== 'all' ? ['all', artwork.targetGroupId] : ['all'];
      
      newPhotoId = await db.photos.add({
        status: 'processed',
        L: lab[0], a: lab[1], b: lab[2],
        url: dataUrl,
        timestamp: Date.now(),
        useCount: 1,
        groups: groups
      });
    }
    
    alert('成功提取現實色彩！填入拼圖！');
    
    const newPieces = pieces.map(p => {
      if(p.id === targetPiece.id) {
        return {
          ...p,
          state: 'filled',
          targetRGB: [128, 128, 128],
          assignedPhotoUrl: dataUrl
        };
      }
      return p;
    });

    setPieces(newPieces);

    // Update the piece in db
    await db.mosaicPieces.update(targetPiece.id, {
       state: 'filled',
       assignedPhotoId: newPhotoId,
       targetRGB: [128,128,128], // can omit strictly
       assignedPhotoUrl: dataUrl
    });

    // Check if fully completed
    const stillMissing = newPieces.filter(p => p.state === 'missing').length;
    if(stillMissing === 0) {
      await db.artworks.update(currentArtworkId, { status: 'completed' });
    }

    setTargetPiece(null);
    setActiveTab('mosaic');
  };

  return (
    <div className="App">
      <header className="header">
        <h1>Mosaic<br />Album</h1>
        {backgroundProgress && (
           <div style={{ color: '#aaa', fontSize: '12px', flex: 1, textAlign: 'left', marginLeft: '20px' }}>
              正在優化色彩匹配 {backgroundProgress.completed} / {backgroundProgress.total}
           </div>
        )}
        <div className="tabs">
          <button 
            className={activeTab === 'library' ? 'active' : ''} 
            onClick={() => setActiveTab('library')}
          >
            素材庫
          </button>
          <button 
            className={activeTab === 'gallery' ? 'active' : ''} 
            onClick={() => setActiveTab('gallery')}
          >
            藝術畫廊
          </button>
          
          {currentArtworkId && (
            <button 
              className={(activeTab === 'mosaic' && !isProcessing) ? 'active' : ''} 
              onClick={() => setActiveTab('mosaic')}
            >
              目前畫布
            </button>
          )}

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

        {!isProcessing && activeTab === 'library' && (
          <LibraryView onProcessingBackground={startBackgroundProcessing} />
        )}

        {!isProcessing && activeTab === 'gallery' && (
          <ArtworksGallery 
            onNewArtwork={handleNewArtwork} 
            onOpenArtwork={handleOpenArtwork} 
          />
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
                      border: p.state === 'missing' ? '0.5px dashed rgba(255,255,255,0.15)' : 'none',
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
