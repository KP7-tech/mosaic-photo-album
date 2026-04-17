import React, { useState, useRef } from 'react';
import { db } from '../db/database';
import { useLiveQuery } from 'dexie-react-hooks';
import './ArtworksGallery.css';

export default function ArtworksGallery({ onNewArtwork, onOpenArtwork }) {
  const artworks = useLiveQuery(() => db.artworks.orderBy('timestamp').reverse().toArray()) || [];
  const groups = useLiveQuery(() => db.groups.toArray()) || [];

  const blueprintInputRef = useRef(null);

  const handleUploadClick = () => {
    blueprintInputRef.current.click();
  };

  const handleBlueprintSelected = async (e) => {
    const file = e.target.files[0];
    if(!file) return;

    // We can show a prompt to ask which group to use
    let targetGroupId = 'all';
    if(groups.length > 1) {
       const groupNames = groups.map(g => `${g.name} (${g.id})`).join('\n');
       const ans = prompt(`此畫作要綁定哪個素材相簿？ (預設為 全部素材: all)\n${groupNames}`, 'all');
       if(ans) {
           const targetG = groups.find(g => g.name.includes(ans) || g.id === ans);
           if(targetG) targetGroupId = targetG.id;
       }
    }

    onNewArtwork(file, targetGroupId);
  };

  const handleDeleteArtwork = async (e, id) => {
    e.stopPropagation();
    if(window.confirm('確定要刪除這件藝術品嗎？')) {
      await db.artworks.delete(id);
      await db.mosaicPieces.where('artworkId').equals(id).delete();
    }
  };

  return (
    <div className="artworks-gallery">
      <h2>我的藝術品 My Artworks</h2>
      
      <input 
        type="file" 
        accept="image/*" 
        onChange={handleBlueprintSelected} 
        ref={blueprintInputRef}
        style={{ display: 'none' }} 
      />

      <div className="artworks-grid">
         {/* 新增專案 */}
         <div className="artwork-card add-card" onClick={handleUploadClick}>
            <div className="add-icon">＋</div>
            <div className="add-text">建立新畫布</div>
         </div>

         {/* 已存在的專案 */}
         {artworks.map(art => (
             <div key={art.id} className="artwork-card" onClick={() => onOpenArtwork(art.id)}>
                 <div className="thumb-container">
                     {art.thumbDataUrl ? (
                         <img src={art.thumbDataUrl} alt={art.name} />
                     ) : (
                         <div className="placeholder">無縮圖</div>
                     )}
                     <button className="del-btn" onClick={(e) => handleDeleteArtwork(e, art.id)}>×</button>
                 </div>
                 <div className="art-info">
                     <div className="art-name">{art.name}</div>
                     <div className="art-meta">
                         {art.status === 'completed' ? '已完成' : '進行中'} · {art.piecesCount} 塊
                     </div>
                 </div>
             </div>
         ))}
      </div>
    </div>
  );
}
