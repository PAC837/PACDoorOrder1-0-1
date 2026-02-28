import type { TextureManifest } from '../types.js';

// ---------------------------------------------------------------------------
// IndexedDB persistence for FileSystemDirectoryHandle objects
// ---------------------------------------------------------------------------

const DB_NAME = 'pac-door-order';
const STORE_NAME = 'folder-handles';
const DB_VERSION = 1;

export type HandleKey = 'tools' | 'libraries' | 'textures';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveHandle(key: HandleKey, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getHandle(key: HandleKey): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function removeHandle(key: HandleKey): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// ---------------------------------------------------------------------------
// Permission check + re-request
// ---------------------------------------------------------------------------

export async function verifyPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: 'read' as const };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if ((await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Folder picking
// ---------------------------------------------------------------------------

export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker({ mode: 'read' });
  } catch {
    // User cancelled or API not supported
    return null;
  }
}

// ---------------------------------------------------------------------------
// Folder scanning
// ---------------------------------------------------------------------------

export interface ToolsStatus {
  toolGroups: boolean;
  toolLib: boolean;
  allPresent: boolean;
}

export async function scanToolsFolder(handle: FileSystemDirectoryHandle): Promise<ToolsStatus> {
  let toolGroups = false;
  let toolLib = false;
  for await (const [name] of handle.entries()) {
    if (name === 'ToolGroups.dat') toolGroups = true;
    if (name === 'ToolLib.dat') toolLib = true;
    if (toolGroups && toolLib) break;
  }
  return { toolGroups, toolLib, allPresent: toolGroups && toolLib };
}

export async function scanLibrariesFolder(handle: FileSystemDirectoryHandle): Promise<string[]> {
  const libs: string[] = [];
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== 'directory') continue;
    const subDir = await handle.getDirectoryHandle(name);
    let hasDoors = false;
    for await (const [subName] of subDir.entries()) {
      if (subName === 'Doors.dat') { hasDoors = true; break; }
    }
    if (hasDoors) libs.push(name);
  }
  return libs.sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// File reading
// ---------------------------------------------------------------------------

export async function readDatFile(
  dirHandle: FileSystemDirectoryHandle,
  filename: string,
): Promise<string> {
  const fileHandle = await dirHandle.getFileHandle(filename);
  const file = await fileHandle.getFile();
  return file.text();
}

export async function readLibraryDat(
  librariesHandle: FileSystemDirectoryHandle,
  libraryName: string,
): Promise<string> {
  const libDir = await librariesHandle.getDirectoryHandle(libraryName);
  return readDatFile(libDir, 'Doors.dat');
}

// ---------------------------------------------------------------------------
// Texture scanning — returns manifest + blob URLs
// ---------------------------------------------------------------------------

export interface ScannedTextures {
  manifest: TextureManifest;
  blobUrls: Map<string, string>;  // relPath → blob URL
}

async function listJpgEntries(
  dir: FileSystemDirectoryHandle,
): Promise<{ name: string; handle: FileSystemFileHandle }[]> {
  const files: { name: string; handle: FileSystemFileHandle }[] = [];
  for await (const [name, entry] of dir.entries()) {
    if (entry.kind === 'file' && /\.jpe?g$/i.test(name)) {
      files.push({ name, handle: entry as FileSystemFileHandle });
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

async function createBlobUrl(fileHandle: FileSystemFileHandle): Promise<string> {
  const file = await fileHandle.getFile();
  return URL.createObjectURL(file);
}

export async function scanTexturesFolder(
  handle: FileSystemDirectoryHandle,
): Promise<ScannedTextures | null> {
  // Look for "PAC Door Order" subfolder
  let pacDir: FileSystemDirectoryHandle;
  try {
    pacDir = await handle.getDirectoryHandle('PAC Door Order');
  } catch {
    return null;
  }

  const blobUrls = new Map<string, string>();
  const manifest: TextureManifest = {
    painted: {},
    primed: [],
    raw: [],
    sanded: [],
    categories: { painted: false, primed: false, raw: false, sanded: false },
  };

  // Check which category subdirs exist
  const catDirs: Record<string, FileSystemDirectoryHandle | null> = {
    Painted: null, Primed: null, Raw: null, Sanded: null,
  };
  for (const cat of Object.keys(catDirs)) {
    try {
      catDirs[cat] = await pacDir.getDirectoryHandle(cat);
      manifest.categories[cat.toLowerCase() as keyof typeof manifest.categories] = true;
    } catch { /* doesn't exist */ }
  }

  // Painted — enumerate brand sub-folders
  if (catDirs.Painted) {
    for await (const [brandName, brandEntry] of catDirs.Painted.entries()) {
      if (brandEntry.kind !== 'directory') continue;
      const brandDir = await catDirs.Painted.getDirectoryHandle(brandName);
      const files = await listJpgEntries(brandDir);
      const filenames: string[] = [];
      for (const f of files) {
        const relPath = `Painted/${brandName}/${f.name}`;
        blobUrls.set(relPath, await createBlobUrl(f.handle));
        filenames.push(f.name);
      }
      manifest.painted[brandName] = filenames;
    }
  }

  // Primed, Raw, Sanded — flat file lists
  for (const cat of ['Primed', 'Raw', 'Sanded'] as const) {
    if (!catDirs[cat]) continue;
    const files = await listJpgEntries(catDirs[cat]!);
    const filenames: string[] = [];
    for (const f of files) {
      const relPath = `${cat}/${f.name}`;
      blobUrls.set(relPath, await createBlobUrl(f.handle));
      filenames.push(f.name);
    }
    manifest[cat.toLowerCase() as 'primed' | 'raw' | 'sanded'] = filenames;
  }

  return { manifest, blobUrls };
}

export function revokeTextureUrls(urls: Map<string, string>): void {
  for (const url of urls.values()) {
    URL.revokeObjectURL(url);
  }
  urls.clear();
}

// ---------------------------------------------------------------------------
// High-level helpers (used by both AdminPanel and App.tsx)
// ---------------------------------------------------------------------------

/** Try to restore saved libraries handle and scan it. Returns [] if no handle or permission denied. */
export async function restoreLibraries(): Promise<string[]> {
  const handle = await getHandle('libraries');
  if (!handle) return [];
  if ((await handle.queryPermission({ mode: 'read' })) !== 'granted') return [];
  return scanLibrariesFolder(handle);
}

export interface ParseResult {
  success: boolean;
  error?: string;
  stats?: {
    doorsCount: number;
    toolGroupsCount: number;
    toolsCount: number;
    cncDoorsCount: number;
    profilesCount: number;
  };
}

/** Read .dat files from IndexedDB handles and send to server for parsing. */
export async function loadLibraryData(libraryName: string): Promise<ParseResult> {
  const toolsHandle = await getHandle('tools');
  const librariesHandle = await getHandle('libraries');
  if (!toolsHandle || !librariesHandle) {
    return { success: false, error: 'Folders not configured. Open the Admin tab to set up folders.' };
  }

  if (!(await verifyPermission(toolsHandle)) || !(await verifyPermission(librariesHandle))) {
    return { success: false, error: 'Permission denied. Please re-select folders in the Admin tab.' };
  }

  const toolGroupsXml = await readDatFile(toolsHandle, 'ToolGroups.dat');
  const toolLibXml = await readDatFile(toolsHandle, 'ToolLib.dat');
  const doorsXml = await readLibraryDat(librariesHandle, libraryName);

  const res = await fetch('/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doors: doorsXml, toolGroups: toolGroupsXml, toolLib: toolLibXml }),
  });
  return res.json();
}
