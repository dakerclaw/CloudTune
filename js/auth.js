/**
 * CloudTune - Authentication Module
 * 
 * Supports two auth modes:
 * 1. OAuth2 (Google Identity Services) - for direct user Drive access
 * 2. Service Account - backend handles auth, user just configures folder
 * 
 * In SA mode, no auth popup is needed - the backend proxies all Drive requests.
 */

const Auth = (() => {
  let tokenClient = null;
  let accessToken = null;
  let tokenExpiry = null;
  let gisLoaded = false;
  const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';

  // === Service Account Mode ===
  // In SA mode, authentication is handled by the backend.
  // The frontend doesn't need to manage tokens.

  function isServiceAccount() {
    return Config.isServiceAccountMode();
  }

  // === OAuth2 Mode ===

  function waitForGIS() {
    return new Promise((resolve) => {
      if (gisLoaded || typeof google !== 'undefined' && google.accounts) {
        gisLoaded = true;
        resolve();
        return;
      }

      // Poll for GIS availability (max 5 seconds)
      let attempts = 0;
      const maxAttempts = 50; // 50 * 100ms = 5s
      const interval = setInterval(() => {
        attempts++;
        if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
          gisLoaded = true;
          clearInterval(interval);
          resolve();
        } else if (attempts >= maxAttempts) {
          clearInterval(interval);
          resolve(); // Resolve anyway, will fail gracefully in init()
        }
      }, 100);
    });
  }

  async function initOAuth2() {
    if (isServiceAccount()) return; // No OAuth2 needed in SA mode

    const clientId = Config.get('clientId');
    if (!clientId) {
      console.warn('No Google Client ID configured for OAuth2');
      return;
    }

    await waitForGIS();

    if (!gisLoaded) {
      console.error('Google Identity Services not loaded');
      window.dispatchEvent(new CustomEvent('auth-error', {
        detail: { error: { message: 'Google 认证服务加载失败，请检查网络连接' } }
      }));
      return;
    }

    try {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: handleTokenResponse,
        error_callback: handleTokenError,
      });

      console.log('OAuth2 token client initialized');
    } catch (err) {
      console.error('Failed to init OAuth2:', err);
      window.dispatchEvent(new CustomEvent('auth-error', {
        detail: { error: { message: 'OAuth2 初始化失败: ' + err.message } }
      }));
    }
  }

  function handleTokenResponse(response) {
    if (response.error) {
      handleTokenError(response);
      return;
    }

    accessToken = response.access_token;
    tokenExpiry = Date.now() + (response.expires_in || 3600) * 1000;

    console.log('OAuth2 access token obtained');

    window.dispatchEvent(new CustomEvent('auth-success', {
      detail: { token: accessToken, mode: 'oauth2' }
    }));
  }

  function handleTokenError(error) {
    console.error('OAuth2 auth error:', error);
    accessToken = null;
    tokenExpiry = null;

    window.dispatchEvent(new CustomEvent('auth-error', {
      detail: { error, mode: 'oauth2' }
    }));
  }

  function login() {
    if (isServiceAccount()) {
      // In SA mode, "login" means just show the app
      // The backend handles auth automatically
      window.dispatchEvent(new CustomEvent('auth-success', {
        detail: { mode: 'service-account' }
      }));
      return;
    }

    if (!tokenClient) {
      initOAuth2().then(() => {
        if (tokenClient) {
          tokenClient.requestAccessToken({ prompt: '' });
        }
      });
      return;
    }

    tokenClient.requestAccessToken({ prompt: '' });
  }

  function loginWithConsent() {
    if (isServiceAccount()) {
      window.dispatchEvent(new CustomEvent('auth-success', {
        detail: { mode: 'service-account' }
      }));
      return;
    }

    if (!tokenClient) return;
    tokenClient.requestAccessToken({ prompt: 'consent' });
  }

  function logout() {
    if (isServiceAccount()) {
      window.dispatchEvent(new CustomEvent('auth-logout'));
      return;
    }

    if (accessToken && gisLoaded && google.accounts) {
      try {
        google.accounts.oauth2.revoke(accessToken);
      } catch (e) {
        console.warn('Token revoke failed:', e);
      }
    }
    accessToken = null;
    tokenExpiry = null;

    window.dispatchEvent(new CustomEvent('auth-logout'));
  }

  function getToken() {
    if (isServiceAccount()) {
      // In SA mode, token is not needed on the frontend
      return 'sa-mode'; // Return placeholder so drive.js knows auth is "valid"
    }

    // Check if token is expired (with 5-minute buffer)
    if (tokenExpiry && Date.now() >= (tokenExpiry - 5 * 60 * 1000)) {
      accessToken = null;
      tokenExpiry = null;
      return null;
    }
    return accessToken;
  }

  function isAuthenticated() {
    if (isServiceAccount()) return true; // SA mode is always "authenticated"
    return !!getToken();
  }

  async function refreshToken() {
    if (isServiceAccount()) return;

    if (!tokenClient) {
      await initOAuth2();
    }
    if (tokenClient) {
      tokenClient.requestAccessToken({ prompt: '' });
    }
  }

  function init() {
    if (isServiceAccount()) {
      // SA mode - no frontend auth needed
      console.log('Auth: Service Account mode - backend handles auth');
      return;
    }

    initOAuth2();
  }

  return {
    init,
    login,
    loginWithConsent,
    logout,
    getToken,
    isAuthenticated,
    refreshToken,
    isServiceAccount,
    SCOPES,
  };
})();
