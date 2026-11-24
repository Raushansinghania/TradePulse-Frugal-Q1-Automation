/**
 * Q1 Requirement B: Dynamic Multi-Conditional State Guardian Test Suite
 * Senior SDET Automated Synchronization Specification
 */

const { test, expect } = require('@playwright/test');
const { StateGuardian } = require('./helpers/state-guardian');

test.describe('Dynamic Multi-Conditional State Guardian (Requirement B)', () => {

  test('B1: Verify verified state progression (IDLE -> LOADING -> RENDERING -> SYNCHRONIZED)', async ({ page }) => {
    const guardian = new StateGuardian({ timeoutMs: 15000 });

    // Arm the guardian hooks before navigation
    await page.addInitScript(() => {
      window.__guardianInitTransitions = [];
      const observer = new MutationObserver(() => {
        const el = document.getElementById('appState');
        if (el) {
          window.__guardianInitTransitions.push({
            state: el.dataset.state,
            sync: el.dataset.stateSync,
            time: performance.now()
          });
        }
      });
      document.addEventListener('DOMContentLoaded', () => {
        const el = document.getElementById('appState');
        if (el) {
          window.__guardianInitTransitions.push({
            state: el.dataset.state,
            sync: el.dataset.stateSync,
            time: performance.now()
          });
          observer.observe(el, { attributes: true, attributeFilter: ['data-state', 'data-state-sync'] });
        }
      });
    });

    await page.goto('/');

    const syncReport = await guardian.waitForSynchronization(page);

    console.log('[TEST B1 SYNC REPORT]', {
      success: syncReport.success,
      elapsedMs: syncReport.elapsedMs,
      finalState: syncReport.finalState,
      finalSync: syncReport.finalSync,
      eventsCount: syncReport.events.length,
      transitions: syncReport.transitions
    });

    // 1. Verify synchronization reached successfully
    expect(syncReport.success).toBe(true);
    expect(syncReport.finalSync).toBe('true');
    expect(syncReport.finalState).toBe('synchronized');

    // 2. Verify state progression contains intermediate states
    const observedStates = syncReport.transitions.map(t => t.state);
    console.log('[OBSERVED STATE PROGRESSION]', observedStates);

    expect(observedStates).toContain('loading');
    expect(observedStates).toContain('rendering');
    expect(observedStates).toContain('synchronized');

    // 3. Verify custom event tradepulse:rendered fired
    expect(syncReport.events.length).toBeGreaterThan(0);
    const lastEvent = syncReport.events[syncReport.events.length - 1];
    expect(lastEvent.type).toBe('tradepulse:rendered');
    expect(lastEvent.detail.sequence).toBeGreaterThan(0);
    expect(lastEvent.detail.price).toBeGreaterThan(0);

    // 4. Verify performance timestamp
    expect(syncReport.lastRenderAt).toBeGreaterThan(0);

    // 5. Verify canvas rendering completion
    expect(syncReport.canvasVerified).toBe(true);

    // 6. Verify price consistency across DOM and diagnostics
    const livePriceText = await page.locator('#livePrice').textContent();
    const orderPriceText = await page.locator('#orderPrice').textContent();
    const diagState = syncReport.diagnostics;

    expect(livePriceText).toBe(orderPriceText);
    expect(diagState.price).toBeGreaterThan(0);
    expect(diagState.connection).toBe(true);

    // Save report to evidence/synchronization-report.json
    guardian.saveReport('synchronization-report.json');
  });

  test('B2: Verify timeout deadline behavior with structured diagnostics on failure', async ({ page }) => {
    const guardian = new StateGuardian({ timeoutMs: 500 }); // Unrealistically short deadline to verify failure path

    await page.goto('/');

    try {
      await guardian.waitForSynchronization(page, 200);
      throw new Error('Should not have synchronized in 200ms');
    } catch (failureDiag) {
      console.log('[TEST B2 INTENTIONAL TIMEOUT DIAGNOSTICS]', failureDiag);
      expect(failureDiag.success).toBe(false);
      expect(failureDiag.error).toContain('Guardian synchronization deadline exceeded');
      expect(failureDiag.missingConditions).toBeDefined();
    }
  });

});
