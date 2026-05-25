// Detects "essentially silent" recordings by decoding the audio track and
// counting samples below a quiet threshold. The backend rejects silent
// recordings with a 400; catching it here lets the user re-record before
// committing to an upload that's going to fail.
//
// Threshold: >95% of samples below ~-50 dB. Conservative defaults;
// tune against typical room noise once we see real recordings.

const SILENCE_THRESHOLD_DB = -50;
const SILENT_FRACTION = 0.95;

export async function checkAudioSilence(blob) {
  let audioContext;
  try {
    audioContext = new AudioContext();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // amplitude = 10^(dB/20). -50 dB ≈ 0.00316 linear amplitude.
    const threshold = Math.pow(10, SILENCE_THRESHOLD_DB / 20);

    // Sample the first channel; for stereo this is the left channel, which
    // is a close-enough approximation for a silence heuristic.
    const channelData = audioBuffer.getChannelData(0);
    if (channelData.length === 0) {
      return { silent: true, silentFraction: 1, durationSeconds: 0 };
    }

    let silentSamples = 0;
    for (let i = 0; i < channelData.length; i++) {
      if (Math.abs(channelData[i]) < threshold) silentSamples++;
    }

    const silentFraction = silentSamples / channelData.length;
    return {
      silent: silentFraction > SILENT_FRACTION,
      silentFraction,
      durationSeconds: audioBuffer.duration,
    };
  } finally {
    if (audioContext) {
      try {
        await audioContext.close();
      } catch {
        // Already closed or never opened — ignore.
      }
    }
  }
}
