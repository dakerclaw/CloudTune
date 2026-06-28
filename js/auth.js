/**
 * CloudTune - Auth Module (SA-only)
 * Checks backend /api/status to confirm SA mode is available.
 */

const Auth = (() => {
  let saAvailable = false;
  let saEmail = '';

  async function detectMode() {
    try {
      const res = await fetch('/api/status', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        if (data.mode === 'service-account') {
          saAvailable = true;
          saEmail = data.saEmail || '';
          return true;
        }
      }
    } catch (e) {
      console.warn('Backend not available:', e.message);
    }
    return false;
  }

  function isServiceAccount() { return saAvailable; }
  function getSAEmail() { return saEmail; }

  return { detectMode, isServiceAccount, getSAEmail };
})();
