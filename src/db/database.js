// src/db/database.js
import Dexie from 'dexie';

export const db = new Dexie('MosaicArchive');

// Schema definitions
db.version(1).stores({
  photos: '++id, status, L, a, b, url, timestamp, useCount',
  mosaicPieces: 'id, xIndex, yIndex, targetL, targetA, targetB, state, assignedPhotoId'
});

// Fetch only fully processed photos for the KD-Tree index
export async function getAllPhotosForIndex() {
  return await db.photos.where('status').equals('processed').toArray();
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
export async function addRawPhoto(file) {
  return await db.photos.add({
    file,           // store the original File or Blob
    status: 'pending',
    timestamp: Date.now(),
    useCount: 0
  });
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
