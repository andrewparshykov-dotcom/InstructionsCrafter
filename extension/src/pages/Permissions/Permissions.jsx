import React, { useEffect } from "react";

const Recorder = () => {
  useEffect(() => {
    window.parent.postMessage(
      {
        type: "instructionscrafter-permissions-loaded",
      },
      "*"
    );
  }, []);

  useEffect(() => {
    const handleDeviceChange = () => {
      // Recheck permission and enumerate devices
      checkPermissions();
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange
      );
    };
  }, []);

  const checkPermissions = async () => {
    // Check microphone permission only; the extension records screen + audio
    // narration and never uses the camera. (Camera permission was asked for
    // historically when the Screenity camera-overlay UI existed.)
    try {
      const microphonePermission = await navigator.permissions.query({
        name: "microphone",
      });

      microphonePermission.onchange = () => {
        checkPermissions();
      };

      if (microphonePermission.state === "granted") {
        enumerateDevices(true);
      } else {
        window.parent.postMessage(
          {
            type: "instructionscrafter-permissions",
            success: false,
            error: err.name,
          },
          "*"
        );
      }
    } catch (err) {
      enumerateDevices();
    }
  };

  const enumerateDevices = async (micGranted = true) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: micGranted,
      });

      const devicesInfo = await navigator.mediaDevices.enumerateDevices();

      let audioinput = [];
      let audiooutput = [];

      if (micGranted) {
        // Filter by audio input
        audioinput = devicesInfo
          .filter((device) => device.kind === "audioinput")
          .map((device) => ({
            deviceId: device.deviceId,
            label: device.label,
          }));

        // Filter by audio output and extract relevant properties
        audiooutput = devicesInfo
          .filter((device) => device.kind === "audiooutput")
          .map((device) => ({
            deviceId: device.deviceId,
            label: device.label,
          }));
      }

      // Save in Chrome local storage
      chrome.storage.local.set({
        audioinput: audioinput,
        audiooutput: audiooutput,
        microphonePermission: micGranted,
      });

      // Post message to parent window
      window.parent.postMessage(
        {
          type: "instructionscrafter-permissions",
          success: true,
          audioinput: audioinput,
          audiooutput: audiooutput,
          microphonePermission: micGranted,
        },
        "*"
      );

      // End the stream
      stream.getTracks().forEach(function (track) {
        track.stop();
      });
    } catch (err) {
      // Post message to parent window
      window.parent.postMessage(
        {
          type: "instructionscrafter-permissions",
          success: false,
          error: err.name,
        },
        "*"
      );
    }
  };

  const onMessage = (message) => {
    if (message.type === "instructionscrafter-get-permissions") {
      checkPermissions();
    }
  };

  // Post message listener
  useEffect(() => {
    window.addEventListener("message", (event) => {
      onMessage(event.data);
    });
  }, []);

  return <div></div>;
};

export default Recorder;
