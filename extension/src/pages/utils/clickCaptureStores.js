// Shared IndexedDB stores for Click-capture mode.
//
// Three contexts touch this data and MUST agree on the config, so they all
// import it from here rather than re-declaring it:
//   - the background service worker writes one screenshot per click,
//   - the offscreen audio recorder writes the optional narration blob,
//   - the Generate page reads both to build the upload.
//
// Two separate IndexedDB databases (rather than one DB with two object stores)
// sidesteps localforage's multi-store version-bump quirk. localforage stores
// Blobs natively in the IndexedDB driver.

import localforage from "localforage";

export const clickShotsStore = localforage.createInstance({
  driver: localforage.INDEXEDDB,
  name: "ic-clickshots",
});

export const clickAudioStore = localforage.createInstance({
  driver: localforage.INDEXEDDB,
  name: "ic-clickaudio",
});

// The single key the narration blob is stored under in clickAudioStore.
export const CLICK_AUDIO_KEY = "narration";

// Wipe both stores. Called at the start of each click-capture session (fresh
// slate) and when a recording is discarded.
export async function clearClickCaptureStores() {
  await Promise.allSettled([clickShotsStore.clear(), clickAudioStore.clear()]);
}
