// src/db/database.js
import Dexie from 'dexie';

export const db = new Dexie('MosaicPhotoAlbum');

// Define the schema.
// IndexedDB with Dexie allows indexing on multiple properties.
// While we use KD-Tree for color search, this DB is for persistent storage
// so we don't have to rebuild thumbnails and calculate RGB every single time.
db.version(1).stores({
  photos: 'id, L, a, b, url, timestamp, useCount',
  mosaicPieces: 'id, xIndex, yIndex, targetL, targetA, targetB, state, assignedPhotoId'
});

// Helper to get all photos for tree building
export async function getAllPhotosForIndex() {
  return await db.photos.toArray();
}

// Update photo usage
export async function incrementPhotoUsage(id) {
  const photo = await db.photos.get(id);
  if (photo) {
    await db.photos.update(id, { useCount: (photo.useCount || 0) + 1 });
  }
}

export async function addPhoto(lab, dataUrl) {
  return await db.photos.add({
    L: lab[0],
    a: lab[1],
    b: lab[2],
    url: dataUrl,
    timestamp: Date.now(),
    useCount: 0
  });
}

export async function clearPhotos() {
  return await db.photos.clear();
}
