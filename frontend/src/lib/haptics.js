// Haptics.
//
// A Next press already shows a spinner and a chip, but in a car you are not looking
// at the screen — a short buzz is the fastest way to say "that press registered".
//
// iOS Safari has no navigator.vibrate at all, so this is a progressive nicety: on
// Android it makes the transport feel physical, everywhere else it is silently
// nothing. Nothing here may ever throw or be awaited.
let enabled = true;

const buzz = (pattern) => {
  try {
    if (enabled && typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  } catch {
    /* haptics are a nicety, never a hard failure */
  }
};

export const setHapticsEnabled = (on) => {
  enabled = Boolean(on);
};

export const isHapticsEnabled = () => enabled;

/** A light tick: a transport button was pressed. */
export const tap = () => buzz(8);

/** Two quick pulses: something changed for the better (favourite saved, cast). */
export const confirm = () => buzz([10, 40, 14]);

/** A longer double pulse: the app is stepping in (weak signal, rescue stream). */
export const warn = () => buzz([16, 70, 16]);
