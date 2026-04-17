import React, { useState, useRef, useEffect } from 'react';
import { db, getGroups, addGroup, renameGroup, deleteGroup, updatePhotoGroups, addRawPhoto } from '../db/database';
import { useLiveQuery } from 'dexie-react-hooks';
import './LibraryView.css';

export default function LibraryView({ onProcessingBackground }) {
  const [activeGroup, setActiveGroup] = useState('all');
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  
  const groups = useLiveQuery(() => getGroups(), []) || [];
  
  // Fetch photos for the active group, sorted by newest
  const photos = useLiveQuery(() => {
    if(activeGroup === 'all') {
      return db.photos.orderBy('timestamp').reverse().toArray();
    } else {
      return db.photos.where('groups').equals(activeGroup).reverse().toArray();
    }
  }, [activeGroup]) || [];

  const fileInputRef = useRef(null);
  // Cache object URLs to avoid creating thousands of new blobs on every render
  const objUrlCache = useRef({});

  // Cleanup object URLs when component unmounts
  useEffect(() => {
    return () => {
      Object.values(objUrlCache.current).forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  const getPhotoSrc = (p) => {
    if (p.url) return p.url;
    if (!p.file) return '';
    if (!objUrlCache.current[p.id]) {
      objUrlCache.current[p.id] = URL.createObjectURL(p.file);
    }
    return objUrlCache.current[p.id];
  };

  const handleUploadClick = () => {
    fileInputRef.current.click();
  };

  const handleFilesSelected = async (e) => {
    const files = e.target.files;
    if(!files.length) return;
    
    // Upload and assign to 'all' AND the currently active group
    const targetGroups = activeGroup === 'all' ? ['all'] : ['all', activeGroup];
    
    // Batch processing
    const fileArray = Array.from(files);
    const chunkSize = 50; 
    for(let i=0; i<fileArray.length; i+=chunkSize) {
        const chunk = fileArray.slice(i, i+chunkSize);
        await Promise.all(chunk.map(file => addRawPhoto(file, targetGroups)));
    }
    
    // Reset input value so same files can be re-selected
    e.target.value = '';
    onProcessingBackground();
  };

  const togglePhotoSelection = (id) => {
    const newSet = new Set(selectedPhotos);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedPhotos(newSet);
  };

  const handleCreateGroup = async () => {
    const name = prompt('請輸入新相簿/群組名稱：', '新相簿');
    if (name) {
      const id = await addGroup(name);
      setActiveGroup(id);
    }
  };

  const handleRenameGroup = async () => {
    if (activeGroup === 'all') return;
    const currentGroup = groups.find(g => g.id === activeGroup);
    const name = prompt('重新命名相簿：', currentGroup?.name);
    if (name) {
      await renameGroup(activeGroup, name);
    }
  };

  const handleDeleteGroup = async () => {
    if (activeGroup === 'all') return;
    if (window.confirm('確定要刪除此群組嗎？照片將從該群組移除，但不會從「全部素材」刪除。')) {
      await deleteGroup(activeGroup);
      setActiveGroup('all');
    }
  };

  const handleDeletePhotos = async () => {
    if (selectedPhotos.size === 0) return;
    
    if (activeGroup === 'all') {
      if (window.confirm(`確定要從資料庫徹底刪除這 ${selectedPhotos.size} 張照片嗎？(無法復原)`)) {
        // Revoke cached object URLs for deleted photos
        selectedPhotos.forEach(id => {
          if (objUrlCache.current[id]) {
            URL.revokeObjectURL(objUrlCache.current[id]);
            delete objUrlCache.current[id];
          }
        });
        await db.photos.bulkDelete(Array.from(selectedPhotos));
        setSelectedPhotos(new Set());
      }
    } else {
      if (window.confirm(`確定要將這 ${selectedPhotos.size} 張照片移出此群組嗎？`)) {
        const ids = Array.from(selectedPhotos);
        const photosToUpdate = await db.photos.where('id').anyOf(ids).toArray();
        for (const p of photosToUpdate) {
            const newGroups = p.groups.filter(g => g !== activeGroup);
            await updatePhotoGroups(p.id, newGroups);
        }
        setSelectedPhotos(new Set());
        setIsEditMode(false);
      }
    }
  };

  const handleMoveToGroup = async () => {
    if (selectedPhotos.size === 0) return;
    const availableGroups = groups.filter(g => g.id !== 'all' && g.id !== activeGroup);
    if (availableGroups.length === 0) {
        alert('沒有其他可用的相簿/群組，請先建立新相簿！');
        return;
    }
    
    const groupNames = availableGroups.map(g => g.name).join('、');
    const nameStr = prompt(`要加入哪個群組？\n可用：${groupNames}`);
    if (!nameStr) return;
    
    const targetG = availableGroups.find(g => g.name.includes(nameStr) || g.id === nameStr);
    if (!targetG) {
        alert('找不到對應的群組');
        return;
    }

    const ids = Array.from(selectedPhotos);
    const photosToUpdate = await db.photos.where('id').anyOf(ids).toArray();
    for (const p of photosToUpdate) {
        if (!p.groups.includes(targetG.id)) {
            await updatePhotoGroups(p.id, [...p.groups, targetG.id]);
        }
    }
    alert(`已將 ${ids.length} 張照片加入「${targetG.name}」`);
    setSelectedPhotos(new Set());
    setIsEditMode(false);
  };

  return (
    <div className="library-view">
      {/* 頂部群組導覽 */}
      <div className="group-tabs">
        {groups.map(g => (
          <button 
            key={g.id} 
            className={`group-chip ${activeGroup === g.id ? 'active' : ''}`}
            onClick={() => { setActiveGroup(g.id); setSelectedPhotos(new Set()); setIsEditMode(false); }}
          >
            {g.name}
          </button>
        ))}
        <button className="group-chip add-group" onClick={handleCreateGroup}>＋ 新增相簿</button>
      </div>

      {/* 工具列 */}
      <div className="toolbar">
        <div className="group-actions">
           {activeGroup !== 'all' && (
               <>
                 <button className="btn-icon" onClick={handleRenameGroup} title="重新命名">✏️</button>
                 <button className="btn-icon" onClick={handleDeleteGroup} title="刪除群組">🗑️</button>
               </>
           )}
        </div>

        <div className="edit-actions">
          {isEditMode ? (
            <>
              <span className="selected-count">已選 {selectedPhotos.size} 張</span>
              <button className="btn-sub" onClick={handleMoveToGroup} disabled={selectedPhotos.size === 0}>移動/加入到...</button>
              <button className="btn-danger" onClick={handleDeletePhotos} disabled={selectedPhotos.size === 0}>
                 {activeGroup === 'all' ? '徹底刪除' : '移出群組'}
              </button>
              <button className="btn-sub" onClick={() => { setIsEditMode(false); setSelectedPhotos(new Set()); }}>完成</button>
            </>
          ) : (
            <button className="btn-sub" onClick={() => setIsEditMode(true)}>編輯選取</button>
          )}
        </div>
      </div>

      {/* 隱藏的上傳 input */}
      <input 
        type="file" 
        multiple 
        accept="image/*" 
        onChange={handleFilesSelected} 
        ref={fileInputRef}
        style={{ display: 'none' }} 
      />

      {/* 圖片網格 */}
      <div className="photo-grid">
         {/* 第一格：新增按鈕（非編輯模式才顯示） */}
         {!isEditMode && (
             <div className="photo-cell add-cell" onClick={handleUploadClick}>
                <div className="add-icon">＋</div>
                <div className="add-text">新增圖片</div>
             </div>
         )}

         {photos.map(p => {
             const isSelected = selectedPhotos.has(p.id);
             return (
               <div 
                 key={p.id} 
                 className={`photo-cell ${isSelected ? 'selected' : ''}`}
                 onClick={() => isEditMode && togglePhotoSelection(p.id)}
               >
                 <img 
                   src={getPhotoSrc(p)} 
                   alt="素材" 
                   loading="lazy"
                 />
                 {isEditMode && (
                     <div className="checkbox">
                        {isSelected && <span className="checkmark">✓</span>}
                     </div>
                 )}
                 {p.status === 'pending' && <div className="loading-badge">處理中</div>}
               </div>
             );
         })}
      </div>
    </div>
  );
}
