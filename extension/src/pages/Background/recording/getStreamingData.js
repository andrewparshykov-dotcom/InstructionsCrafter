export const getStreamingData = async () => {
  try {
    const {
      micActive,
      defaultAudioInput,
      systemAudio,
      recordingType,
    } = await chrome.storage.local.get([
      "micActive",
      "defaultAudioInput",
      "systemAudio",
      "recordingType",
    ]);

    return {
      micActive,
      defaultAudioInput,
      systemAudio,
      recordingType,
    };
  } catch (error) {
    console.error("Failed to retrieve streaming data:", error);
    return null;
  }
};
