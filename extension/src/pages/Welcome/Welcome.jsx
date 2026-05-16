import React from "react";

// First-run welcome page that replaces Screenity's setup.html. The narration
// requirement callout is the primary purpose: silent recordings are rejected
// by the backend, so visibility BEFORE the user records is the cheapest fix.

const Welcome = () => {
  const handleClose = () => {
    window.close();
  };

  return (
    <div style={styles.page}>
      <h1 style={styles.heading}>Welcome to InstructionsCrafter</h1>
      <p style={styles.subheading}>
        Record your screen with voice narration and turn it into a step-by-step
        Microsoft Word instruction document.
      </p>

      <div style={styles.callout}>
        <h2 style={styles.calloutHeading}>
          Important: voice narration is required
        </h2>
        <p style={styles.calloutBody}>
          InstructionsCrafter builds each step in the document from what you
          <em> say </em>
          while recording, not from what you click. Talk through each step out
          loud as you record. For example:
        </p>
        <p style={styles.calloutExample}>
          "First, I'm clicking on the menu icon in the top-left. Now I'm
          selecting Settings from the dropdown. Finally, I'm clicking Save."
        </p>
        <p style={styles.calloutBody}>
          A silent recording will be rejected with an error after upload.
        </p>
      </div>

      <h2 style={styles.sectionHeading}>How it works</h2>
      <ol style={styles.steps}>
        <li>Click the toolbar icon to open the recorder.</li>
        <li>
          Pick the current tab, a window, or the full desktop. Keep the
          microphone enabled.
        </li>
        <li>Click record, narrate through your steps, then click stop.</li>
        <li>
          On the Recording Ready page, click "Generate Instruction Document."
          Enter a title and the shared team password.
        </li>
        <li>
          Wait 30 to 60 seconds. A Microsoft Word document downloads
          automatically.
        </li>
      </ol>

      <div style={styles.actions}>
        <button style={styles.button} onClick={handleClose}>
          Got it &mdash; let me record
        </button>
      </div>
    </div>
  );
};

const styles = {
  page: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    maxWidth: 680,
    margin: "0 auto",
    padding: 40,
    color: "#222",
    lineHeight: 1.5,
    background: "#fff",
    borderRadius: 8,
    marginTop: 40,
    marginBottom: 40,
    boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
  },
  heading: { fontSize: 26, margin: "0 0 8px" },
  subheading: { color: "#555", margin: "0 0 24px", fontSize: 15 },
  callout: {
    background: "#fff8e1",
    border: "1px solid #f0c97a",
    borderRadius: 8,
    padding: 20,
    marginBottom: 32,
  },
  calloutHeading: { fontSize: 16, margin: "0 0 8px", color: "#8a5a00" },
  calloutBody: { fontSize: 14, margin: "0 0 8px", color: "#444" },
  calloutExample: {
    fontSize: 13,
    fontStyle: "italic",
    margin: "8px 0",
    padding: "8px 12px",
    background: "#fffdf4",
    borderLeft: "3px solid #f0c97a",
    color: "#555",
  },
  sectionHeading: { fontSize: 18, margin: "0 0 12px" },
  steps: { paddingLeft: 24, color: "#333", fontSize: 14 },
  actions: { marginTop: 32, textAlign: "center" },
  button: {
    padding: "12px 24px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    border: "1px solid #2a7",
    background: "#2a7",
    color: "#fff",
    borderRadius: 6,
  },
};

export default Welcome;
