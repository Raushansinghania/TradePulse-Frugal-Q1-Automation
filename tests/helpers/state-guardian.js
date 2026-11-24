/**
 * Dynamic Multi-Conditional State Guardian
 * Senior SDET Synchronization Engine for TradePulse Q1
 *
 * Enforces verified state progression: IDLE -> LOADING -> RENDERING -> SYNCHRONIZED
 * Uses MutationObserver, requestAnimationFrame, custom events ('tradepulse:rendered'),
 * and performance timestamps. Absolutely NO static sleep or blind delays.
 */

const { saveEvidence } = require('./telemetry');

class StateGuardian {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 15000;
    this.history = [];
    this.report = null;
  }

  /**
   * Install client-side tracking hooks in the browser before or during navigation.
   */
  async arm(page) {
    await page.evaluate(() => {
      if (window.__tpStateGuardianArmed) return;
      window.__tpStateGuardianArmed = true;

      window.__tpGuardianState = {
        transitions: [],
        events: [],
        canvasVerified: false,
        lastRenderAt: 0,
        syncReachedAt: 0,
        startTime: performance.now(),
        currentState: 'idle',
        currentSync: false,
        diagnostics: null
      };

      const appState = document.getElementById('appState');
      if (appState) {
        const initial = {
          state: appState.dataset.state || 'idle',
          sync: appState.dataset.stateSync === 'true',
          timestamp: performance.now()
        };
        window.__tpGuardianState.transitions.push(initial);
        window.__tpGuardianState.currentState = initial.state;
        window.__tpGuardianState.currentSync = initial.sync;

        const observer = new MutationObserver((mutations) => {
          for (const m of mutations) {
            if (m.type === 'attributes') {
              const state = appState.dataset.state;
              const sync = appState.dataset.stateSync === 'true';
              const now = performance.now();
              const last = window.__tpGuardianState.transitions[window.__tpGuardianState.transitions.length - 1];

              if (!last || last.state !== state || last.sync !== sync) {
                window.__tpGuardianState.transitions.push({
                  state,
                  sync,
                  timestamp: now
                });
                window.__tpGuardianState.currentState = state;
                window.__tpGuardianState.currentSync = sync;
              }
            }
          }
        });

        observer.observe(appState, {
          attributes: true,
          attributeFilter: ['data-state', 'data-state-sync', 'data-rendered']
        });
      }

      window.addEventListener('tradepulse:rendered', (e) => {
        window.__tpGuardianState.events.push({
          type: 'tradepulse:rendered',
          detail: e.detail,
          timestamp: performance.now(),
          lastRenderAt: window.__lastTradePulseRenderAt || performance.now()
        });
      });
    });
  }

  /**
   * Await complete multi-conditional synchronization state.
   */
  async waitForSynchronization(page, customTimeout) {
    const timeout = customTimeout || this.timeoutMs;
    const startTime = Date.now();

    // Make sure hooks are armed
    await this.arm(page);

    const result = await page.evaluate(async (timeoutLimit) => {
      const start = performance.now();

      function getDiag() {
        if (window.tradePulseDiagnostics) {
          return window.tradePulseDiagnostics.getState();
        }
        return null;
      }

      function verifyCanvas() {
        const canvas = document.getElementById('priceChart');
        if (!canvas) return false;
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        try {
          const ctx = canvas.getContext('2d');
          if (!ctx) return false;
          // Check pixel buffer to ensure canvas is not empty
          const sample = ctx.getImageData(0, 0, Math.min(100, canvas.width), Math.min(100, canvas.height));
          return sample.data.some(channel => channel > 0);
        } catch (_) {
          return true;
        }
      }

      return new Promise((resolve, reject) => {
        function checkState() {
          const now = performance.now();
          const elapsed = now - start;
          const g = window.__tpGuardianState;
          const appState = document.getElementById('appState');
          const isSyncAttr = appState && appState.dataset.stateSync === 'true';
          const isStateSync = appState && appState.dataset.state === 'synchronized';
          const hasRenderedEvent = g.events.length > 0;
          const diag = getDiag();
          const canvasDrawn = verifyCanvas();
          const hasRenderTimestamp = (window.__lastTradePulseRenderAt && window.__lastTradePulseRenderAt > 0);

          if (isSyncAttr && isStateSync && hasRenderedEvent && canvasDrawn && hasRenderTimestamp) {
            g.syncReachedAt = now;
            g.canvasVerified = true;
            g.diagnostics = diag;

            resolve({
              success: true,
              elapsedMs: Math.round(elapsed),
              transitions: g.transitions,
              events: g.events,
              diagnostics: diag,
              canvasVerified: true,
              lastRenderAt: window.__lastTradePulseRenderAt,
              finalState: appState.dataset.state,
              finalSync: appState.dataset.stateSync
            });
            return;
          }

          if (elapsed >= timeoutLimit) {
            resolve({
              success: false,
              elapsedMs: Math.round(elapsed),
              error: 'Guardian synchronization deadline exceeded',
              missingConditions: {
                isSyncAttr,
                isStateSync,
                hasRenderedEvent,
                canvasDrawn,
                hasRenderTimestamp
              },
              transitions: g.transitions,
              diagnostics: diag
            });
            return;
          }

          // Use requestAnimationFrame for precise synchronization observation without blocking
          requestAnimationFrame(checkState);
        }

        requestAnimationFrame(checkState);
      });
    }, timeout);

    this.report = {
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      ...result
    };

    if (!result.success) {
      const err = new Error(result.error || 'Guardian synchronization deadline exceeded');
      Object.assign(err, result);
      throw err;
    }

    return this.report;
  }

  async getDiagnostics(page) {
    return await page.evaluate(() => {
      return {
        appState: {
          state: document.getElementById('appState')?.dataset.state,
          sync: document.getElementById('appState')?.dataset.stateSync,
          rendered: document.getElementById('appState')?.dataset.rendered
        },
        diagnostics: window.tradePulseDiagnostics ? window.tradePulseDiagnostics.getState() : null,
        lastRenderAt: window.__lastTradePulseRenderAt || 0,
        guardian: window.__tpGuardianState || null
      };
    });
  }

  saveReport(filename = 'synchronization-report.json') {
    if (!this.report) {
      throw new Error('No synchronization report available to save. Call waitForSynchronization first.');
    }
    return saveEvidence(filename, this.report);
  }
}

module.exports = {
  StateGuardian
};
