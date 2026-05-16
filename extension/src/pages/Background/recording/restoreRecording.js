import { chunksStore } from "./chunkHandler";

const OPFS_RECORDING_PREFIX = "recording-";
const MIN_VALID_RECORDING_BYTES = 4096;

// Reports whether recoverable recording bytes still exist (IDB chunks or OPFS
// files) so the not-enough-space modal can offer "Clear recordings". The
// editor-driven recovery flow was removed in Phase 8 Stage D — leftover files
// are surfaced for cleanup, not reopened.
const listOpfsRecordings = async () => {
  try {
    if (!navigator.storage || typeof navigator.storage.getDirectory !== "function") {
      return [];
    }
    const dir = await navigator.storage.getDirectory();
    const files = [];
    for await (const [name, handle] of dir.entries()) {
      if (!name.startsWith(OPFS_RECORDING_PREFIX)) continue;
      if (!name.endsWith(".mp4")) continue;
      try {
        const file = await handle.getFile();
        if (file.size < MIN_VALID_RECORDING_BYTES) continue;
        files.push({ name, lastModified: file.lastModified, size: file.size });
      } catch {}
    }
    return files;
  } catch {
    return [];
  }
};

export const checkRestore = async () => {
  const [idbChunkCount, opfsFiles] = await Promise.all([
    (async () => {
      let count = 0;
      try {
        await chunksStore.iterate(() => {
          count += 1;
        });
      } catch {}
      return count;
    })(),
    listOpfsRecordings(),
  ]);
  const restore = idbChunkCount > 0 || opfsFiles.length > 0;
  return { restore };
};
