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
  const [viewMode, setViewMode] = useState('mosaic'); // 'mosaic' | 'blueprint'
  const [liveSettings, setLiveSettings] = useState({ maxRepeat: 3, exclusionRadius: 2 });
  const [fullBlueprintUrl, setFullBlueprintUrl] = useState(null);
  const [stats, setStats] = useState({ filled: 0, total: 0, uniquePhotos: 0 });
  
  const workerRef = useRef(null);
  const isWorkerRunning = useRef(false); // guard against duplicate processing calls

  const startBackgroundProcessing = async () => {
    if (isWorkerRunning.current) return; // already running, skip
    const pendingPhotos = await getPendingPhotos();
    if(pendingPhotos.length === 0) {
      setBackgroundProgress(null);
      return;
    }
    
    isWorkerRunning.current = true;
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
             isWorkerRunning.current = false;
             // Refresh current artwork with newly processed photos
             setCurrentArtworkId(prev => prev ? prev : null); // trigger refresh via ref below
             refreshCurrentArtworkRef.current?.();
        }
      };
    }
    
    const payloadFiles = pendingPhotos.map(p => ({ id: p.id, file: p.file }));
    workerRef.current.postMessage({ type: 'PROCESS_FILES', payload: { files: payloadFiles } });
  };

  // Ref to the refresh function so the worker callback can call it without stale closure
  const refreshCurrentArtworkRef = useRef(null);
  const currentArtworkIdRef = useRef(null);
  const artworkSettingsRef = useRef({ maxRepeat: 3, exclusionRadius: 2 });

  useEffect(() => {
    initDefaultGroup();
    startBackgroundProcessing();
    return () => {
      if(workerRef.current) {
        workerRef.current.terminate();
      }
    }
  }, []);

  // Keep currentArtworkId accessible in non-reactive callbacks
  useEffect(() => {
    currentArtworkIdRef.current = currentArtworkId;
  }, [currentArtworkId]);

  // Refresh the current artwork's missing pieces with newly processed photos
  const refreshCurrentArtwork = async (currentPieces, settings) => {
    const artworkId = currentArtworkIdRef.current;
    if (!artworkId || !currentPieces || currentPieces.length === 0) return;

    const artwork = await db.artworks.get(artworkId);
    if (!artwork) return;

    const photos = await getAllPhotosForIndex(artwork.targetGroupId);
    if (photos.length === 0) return;

    const tree = new KDTree(photos, ['L', 'a', 'b']);
    const { maxRepeat, exclusionRadius } = settings || artworkSettingsRef.current;
    const THRESHOLD = 35.0; // Wider threshold for refresh

    // Build usage map from already-filled pieces
    const usageCounts = {};
    // Build a grid map: key = "col,row" -> photoUrl
    const cols = Math.round(artwork.width / (currentPieces[0]?.w || 1));
    const placedMap = {}; // key="col,row" -> photoUrl
    
    currentPieces.forEach(p => {
      if (p.state === 'filled' && p.assignedPhotoUrl) {
        const col = Math.round(p.x / (p.w || 1));
        const row = Math.round(p.y / (p.h || 1));
        placedMap[`${col},${row}`] = p.assignedPhotoUrl;
        usageCounts[p.assignedPhotoUrl] = (usageCounts[p.assignedPhotoUrl] || 0) + 1;
      }
    });

    let updated = false;
    const newPieces = currentPieces.map(p => {
      if (p.state !== 'missing') return p;

      const point = { L: p.targetLAB[0], a: p.targetLAB[1], b: p.targetLAB[2] };
      const col = Math.round(p.x / (p.w || 1));
      const row = Math.round(p.y / (p.h || 1));

      // Try candidates in order until one passes all constraints
      const candidates = tree.nearest(point, Math.min(photos.length, 20));
      for (const { node, distance } of candidates) {
        if (distance > THRESHOLD) break;
        const photoUrl = node.obj.url;
        if (!photoUrl) continue;

        // Check max repeat globally
        if ((usageCounts[photoUrl] || 0) >= maxRepeat) continue;

        // Check exclusion radius (no same photo within NxN neighborhood)
        let tooClose = false;
        for (let dr = -exclusionRadius; dr <= exclusionRadius; dr++) {
          for (let dc = -exclusionRadius; dc <= exclusionRadius; dc++) {
            if (dr === 0 && dc === 0) continue;
            if (placedMap[`${col + dc},${row + dr}`] === photoUrl) {
              tooClose = true;
              break;
            }
          }
          if (tooClose) break;
        }
        if (tooClose) continue;

        // Accept this candidate
        usageCounts[photoUrl] = (usageCounts[photoUrl] || 0) + 1;
        placedMap[`${col},${row}`] = photoUrl;
        updated = true;
        return { ...p, state: 'filled', assignedPhotoUrl: photoUrl };
      }
      return p;
    });

    if (updated) {
      setPieces(newPieces);
      // Persist updated pieces to DB
      const dbUpdates = newPieces
        .filter((p, i) => p.state === 'filled' && currentPieces[i].state === 'missing')
        .map(p => db.mosaicPieces.update(p.id, { state: 'filled', assignedPhotoUrl: p.assignedPhotoUrl }));
      await Promise.all(dbUpdates);

      const stillMissing = newPieces.filter(p => p.state === 'missing').length;
      if (stillMissing === 0) {
        await db.artworks.update(artworkId, { status: 'completed' });
      }
    }
  };

  // Keep the refresh function ref up to date with latest pieces
  useEffect(() => {
    refreshCurrentArtworkRef.current = () => refreshCurrentArtwork(pieces, liveSettings);
  }, [pieces, liveSettings]);

  // Recalculate matches for the entire canvas based on current liveSettings
  const recalculateMosaic = async () => {
    if (!currentArtworkId || isProcessing) return;
    setIsProcessing(true);

    const artwork = await db.artworks.get(currentArtworkId);
    if (!artwork) {
      setIsProcessing(false);
      return;
    }

    const photos = await getAllPhotosForIndex(artwork.targetGroupId);
    if (photos.length === 0) {
      setIsProcessing(false);
      return;
    }

    const tree = new KDTree(photos, ['L', 'a', 'b']);
    const { maxRepeat, exclusionRadius } = liveSettings;
    const THRESHOLD = 35.0;

    const usageCounts = {};
    const placedMap = {};
    const dbUsageCounts = {};

    const newPieces = pieces.map(p => {
      // Create a fresh copy
      const piece = { ...p, state: 'missing', assignedPhotoUrl: null };
      const point = { L: piece.targetLAB[0], a: piece.targetLAB[1], b: piece.targetLAB[2] };
      const col = Math.round(piece.x / piece.w);
      const row = Math.round(piece.y / piece.h);

      const candidates = tree.nearest(point, Math.min(photos.length, 25));
      for (const { node, distance } of candidates) {
        if (distance > THRESHOLD) break;
        const photo = node.obj;
        
        if ((usageCounts[photo.url] || 0) >= maxRepeat) continue;

        let tooClose = false;
        for (let dr = -exclusionRadius; dr <= exclusionRadius; dr++) {
          for (let dc = -exclusionRadius; dc <= exclusionRadius; dc++) {
            if (dr === 0 && dc === 0) continue;
            if (placedMap[`${col + dc},${row + dr}`] === photo.url) {
              tooClose = true;
              break;
            }
          }
          if (tooClose) break;
        }
        if (tooClose) continue;

        usageCounts[photo.url] = (usageCounts[photo.url] || 0) + 1;
        placedMap[`${col},${row}`] = photo.url;
        dbUsageCounts[photo.id] = (dbUsageCounts[photo.id] || 0) + 1;
        piece.state = 'filled';
        piece.assignedPhotoUrl = photo.url;
        break;
      }
      return piece;
    });

    setPieces(newPieces);
    
    // Update DB
    await bulkIncrementUsage(dbUsageCounts); // This is approximate since we don't clear old counts easily here
    // In a real app we'd probably want a more robust usage tracking, but for now this fits the logic.
    
    const dbPieces = newPieces.map(p => ({
        id: p.id,
        state: p.state,
        assignedPhotoUrl: p.assignedPhotoUrl,
        artworkId: currentArtworkId
    }));
    await db.mosaicPieces.bulkPut(dbPieces);

    const missingCount = newPieces.filter(p => p.state === 'missing').length;
    await db.artworks.update(currentArtworkId, { 
        status: missingCount === 0 ? 'completed' : 'in-progress',
        maxRepeat,
        exclusionRadius
    });

    setIsProcessing(false);
  };

  useEffect(() => {
    if (pieces.length > 0) {
      const filled = pieces.filter(p => p.state === 'filled').length;
      const uniquePhotos = new Set(pieces.filter(p => p.state === 'filled').map(p => p.assignedPhotoUrl)).size;
      setStats({ filled, total: pieces.length, uniquePhotos });
    }
  }, [pieces]);

  const handleNewArtwork = async (file, targetGroupId, settings = {}) => {
    const maxRepeat = settings.maxRepeat ?? 3;
    const exclusionRadius = settings.exclusionRadius ?? 2;
    artworkSettingsRef.current = { maxRepeat, exclusionRadius };

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

    // 4. Assign photos with repeat and exclusion constraints
    const THRESHOLD = 15.0;
    const usageCounts = {};      // photoUrl -> count
    const placedMap = {};        // "col,row" -> photoUrl
    const dbUsageCounts = {};    // photoId -> count (for DB)

    for(let piece of newPieces) {
        let assigned = false;
        if(tree) {
            const point = { L: piece.targetLAB[0], a: piece.targetLAB[1], b: piece.targetLAB[2] };
            const col = Math.round(piece.x / piece.w);
            const row = Math.round(piece.y / piece.h);

            // Try top-N candidates (wider pool for better diversity)
            const candidates = tree.nearest(point, Math.min(photos.length, 20));
            for (const { node, distance } of candidates) {
              if (distance > THRESHOLD) break;
              const photo = node.obj;
              if (!photo.url) continue;

              // Check global max repeat
              if ((usageCounts[photo.url] || 0) >= maxRepeat) continue;

              // Check exclusion radius
              let tooClose = false;
              for (let dr = -exclusionRadius; dr <= exclusionRadius; dr++) {
                for (let dc = -exclusionRadius; dc <= exclusionRadius; dc++) {
                  if (dr === 0 && dc === 0) continue;
                  if (placedMap[`${col + dc},${row + dr}`] === photo.url) {
                    tooClose = true;
                    break;
                  }
                }
                if (tooClose) break;
              }
              if (tooClose) continue;

              // Accept
              usageCounts[photo.url] = (usageCounts[photo.url] || 0) + 1;
              placedMap[`${col},${row}`] = photo.url;
              dbUsageCounts[photo.id] = (dbUsageCounts[photo.id] || 0) + 1;
              piece.state = 'filled';
              piece.assignedPhotoUrl = photo.url;
              assigned = true;
              break;
            }
        }
        if(!assigned) {
            piece.state = 'missing';
        }
    }

    if (Object.keys(dbUsageCounts).length > 0) {
        await bulkIncrementUsage(dbUsageCounts);
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
      blueprintFullUrl: await createThumb(file, 1200), // High res blueprint
      maxRepeat,
      exclusionRadius,
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
      setLiveSettings({ 
        maxRepeat: artwork.maxRepeat || 3, 
        exclusionRadius: artwork.exclusionRadius || 2 
      });
      setFullBlueprintUrl(artwork.blueprintFullUrl);
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
            <div className="mosaic-controls">
              <div className="control-group">
                <label>最大重複次數: {liveSettings.maxRepeat}</label>
                <input 
                  type="range" min="1" max="20" step="1" 
                  value={liveSettings.maxRepeat} 
                  onChange={(e) => setLiveSettings({...liveSettings, maxRepeat: parseInt(e.target.value)})} 
                />
              </div>
              <div className="control-group">
                <label>排斥半徑: {liveSettings.exclusionRadius} 格</label>
                <input 
                  type="range" min="0" max="10" step="1" 
                  value={liveSettings.exclusionRadius} 
                  onChange={(e) => setLiveSettings({...liveSettings, exclusionRadius: parseInt(e.target.value)})} 
                />
              </div>
              <button className="btn-secondary" onClick={recalculateMosaic}>重新優化匹配</button>
              <button 
                className={`btn-secondary ${viewMode === 'blueprint' ? 'active' : ''}`} 
                onClick={() => setViewMode(viewMode === 'mosaic' ? 'blueprint' : 'mosaic')}
              >
                {viewMode === 'mosaic' ? '查看原圖' : '查看馬賽克'}
              </button>
            </div>

            <div className="canvas-wrapper">
              <MosaicCanvas 
                pieces={pieces} 
                width={canvasSize.w} 
                height={canvasSize.h} 
                viewMode={viewMode}
                blueprintUrl={fullBlueprintUrl}
              />
              
              {viewMode === 'mosaic' && (
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
              )}
            </div>

            <div className="mosaic-stats">
               <div className="stat-item">
                  <span className="stat-label">完成進度</span>
                  <span className="stat-value">{stats.filled} / {stats.total} ({((stats.filled/stats.total)*100).toFixed(1)}%)</span>
                  <div className="progress-bar-container">
                    <div className="progress-bar-fill" style={{ width: `${(stats.filled/stats.total)*100}%` }}></div>
                  </div>
               </div>
               <div className="stat-item">
                  <span className="stat-label">所用相色數</span>
                  <span className="stat-value">{stats.uniquePhotos} 庫存素材</span>
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
