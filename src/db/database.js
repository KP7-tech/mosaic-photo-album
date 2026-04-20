// src/db/database.js
import Dexie from 'dexie';

export const db = new Dexie('MosaicArchive');

// Schema definitions
db.version(1).stores({
  photos: '++id, status, L, a, b, url, timestamp, useCount',
  mosaicPieces: 'id, xIndex, yIndex, targetL, targetA, targetB, state, assignedPhotoId'
});

db.version(5).stores({
  photos: '++id, status, L, a, b, url, timestamp, useCount, name, size, *groups',
  mosaicPieces: 'id, artworkId, xIndex, yIndex, targetL, targetA, targetB, state, assignedPhotoId',
  groups: 'id, name, isDefault, timestamp',
  artworks: '++id, name, status, width, height, piecesCount, filledCount, thumbDataUrl, blueprintFullUrl, maxRepeat, exclusionRadius, targetGroupId, timestamp'
}).upgrade(tx => {
  // Existing data upgrade logic
  return tx.artworks.toCollection().modify(art => {
    art.filledCount = art.filledCount || 0;
  });
});

// Fetch only fully processed photos for the KD-Tree index, optionally filtered by group
export async function getAllPhotosForIndex(groupId = 'all') {
  if (groupId === 'all') {
    return await db.photos.where('status').equals('processed').toArray();
  }
  return await db.photos.where('groups').equals(groupId).and(p => p.status === 'processed').toArray();
}

// Fetch all pending photos for background processing
export async function getPendingPhotos() {
  return await db.photos.where('status').equals('pending').toArray();
}

// Update photo usage
export async function incrementPhotoUsage(id) {
  const photo = await db.photos.get(id);
  if (photo) {
    await db.photos.update(id, { useCount: (photo.useCount || 0) + 1 });
  }
}

// Bulk update photo usage (performance optimization)
export async function bulkIncrementUsage(usageCounts) {
  // usageCounts is an object { [id]: count }
  return db.transaction('rw', db.photos, async () => {
    for (const [idStr, count] of Object.entries(usageCounts)) {
      const id = parseInt(idStr, 10);
      const photo = await db.photos.get(id);
      if (photo) {
        await db.photos.update(id, { useCount: (photo.useCount || 0) + count });
      }
    }
  });
}

// Old synchronous addition purely for test/camera
export async function addPhoto(lab, dataUrl) {
  return await db.photos.add({
    status: 'processed',
    L: lab[0],
    a: lab[1],
    b: lab[2],
    url: dataUrl,
    timestamp: Date.now(),
    useCount: 0
  });
}

// New async raw photo addition for lazy loading
export async function addRawPhoto(file, targetGroups = ['all']) {
  // Ensure 'all' is always present
  const groupsToAssign = Array.from(new Set(['all', ...targetGroups]));
  return await db.photos.add({
    file,           // store the original File or Blob
    name: file.name,
    size: file.size,
    status: 'pending',
    timestamp: Date.now(),
    useCount: 0,
    groups: groupsToAssign
  });
}

// Check if a photo with the same name and size exists
export async function checkDuplicatePhoto(name, size) {
  const existing = await db.photos.where({ name: name, size: size }).first();
  return !!existing;
}

// Update a raw photo with its processed LAB and miniature dataURL
export async function updatePhotoData(id, lab, dataUrl) {
  return await db.photos.update(id, {
    status: 'processed',
    L: lab[0],
    a: lab[1],
    b: lab[2],
    url: dataUrl
  });
}

export async function clearPhotos() {
  return await db.photos.clear();
}

// Group operations
export async function initDefaultGroup() {
  const existing = await db.groups.get('all');
  if (!existing) {
    await db.groups.put({ id: 'all', name: '全部素材', isDefault: true, timestamp: Date.now() });
  }
}
export async function getGroups() {
  return await db.groups.orderBy('timestamp').toArray();
}
export async function addGroup(name) {
  const id = 'group_' + Date.now();
  await db.groups.add({ id, name, isDefault: false, timestamp: Date.now() });
  return id;
}
export async function renameGroup(id, newName) {
  if(id === 'all') return;
  return await db.groups.update(id, { name: newName });
}
export async function deleteGroup(id) {
  if(id === 'all') return;
  // First, remove this group from all photos
  await db.photos.where('groups').equals(id).modify(photo => {
    photo.groups = photo.groups.filter(g => g !== id);
  });
  // Then delete group
  return await db.groups.delete(id);
}

// Photo Group Assignment
export async function updatePhotoGroups(photoId, newGroups) {
  // ensures 'all' is always in
  const groupsToAssign = Array.from(new Set(['all', ...newGroups]));
  return await db.photos.update(photoId, { groups: groupsToAssign });
}
