// Loads the just-finished recording from Screenity's storage and returns
// a single playable Blob plus metadata. Tries OPFS first (modern WebCodecs
// encoder writes a single muxed file there), falls back to IndexedDB (legacy
// MediaRecorder writes timeslice WebM chunks that concatenate into a valid file).

import localforage from "localforage";

// Mirror Screenity's database name so we open the same store it wrote to.
localforage.config({
  driver: localforage.INDEXEDDB,
  name: "screenity",
  version: 1,
});

const chunksStore = localforage.createInstance({ name: "chunks" });

export async function loadRecording() {
  const { lastRecordingBackendRef } = await chrome.storage.local.get([
    "lastRecordingBackendRef",
  ]);

  if (
    lastRecordingBackendRef?.backend === "opfs" &&
    lastRecordingBackendRef?.fileName
  ) {
    try {
      return await loadFromOpfs(lastRecordingBackendRef.fileName);
    } catch (err) {
      console.warn("OPFS read failed, trying IndexedDB:", err);
    }
  }

  return await loadFromIndexedDB();
}

async function loadFromOpfs(fileName) {
  // fileName may be a nested path like "cloud-chunks/<sessionId>/file.mp4".
  const parts = fileName.split("/").filter(Boolean);
  let dir = await navigator.storage.getDirectory();
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]);
  }
  const handle = await dir.getFileHandle(parts[parts.length - 1]);
  const file = await handle.getFile();

  // Materialize OPFS bytes into memory. Wrapping the File in a Blob via
  // `new Blob([file], ...)` keeps the Blob backed by the OPFS handle; by the
  // time we try to read it later (FileReader, chrome.downloads, XHR), Chrome
  // may have released the underlying reference, producing
  // `NotReadableError: ... permission problems ... after a reference to a
  // file was acquired`. Reading once into an ArrayBuffer detaches us from
  // OPFS — the resulting Blob is purely in-memory.
  const arrayBuffer = await file.arrayBuffer();
  const isMp4 = fileName.toLowerCase().endsWith(".mp4");
  const mimeType = isMp4 ? "video/mp4" : "video/webm";
  const blob = new Blob([arrayBuffer], { type: mimeType });

  return {
    blob,
    mimeType,
    extension: isMp4 ? "mp4" : "webm",
    source: "opfs",
  };
}

async function loadFromIndexedDB() {
  const chunkArray = [];
  await chunksStore.iterate((value) => {
    if (value?.chunk) chunkArray.push(value.chunk);
  });

  if (chunkArray.length === 0) {
    throw new Error(
      "No recording found in storage. The recording may have been deleted, " +
        "or this page was opened before the recording finished. Try recording again."
    );
  }

  const blob = new Blob(chunkArray, { type: "video/webm" });
  return {
    blob,
    mimeType: "video/webm",
    extension: "webm",
    source: "indexeddb",
  };
}
