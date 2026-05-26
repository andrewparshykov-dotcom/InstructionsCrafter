export const getStreamingData = async () => {
  try {
    const {
      micActive,
      defaultAudioInput,
      defaultAudioOutput,
      systemAudio,
      recordingType,
    } = await chrome.storage.local.get([
      "micActive",
      "defaultAudioInput",
      "defaultAudioOutput",
      "systemAudio",
      "recordingType",
    ]);

    return {
      micActive,
      defaultAudioInput,
      defaultAudioOutput,
      systemAudio,
      recordingType,
    };
  } catch (error) {
    console.error("Failed to retrieve streaming data:", error);
    return null;
  }
};
