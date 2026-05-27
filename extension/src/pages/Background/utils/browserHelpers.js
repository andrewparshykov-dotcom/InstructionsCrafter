export const checkAvailableMemory = async () => {
  try {
    const data = await navigator.storage.estimate();

    return { data };
  } catch (error) {
    console.error("Failed to estimate memory:", error);
    return { error: error.message };
  }
};
