/**
 * Q1 Requirement A: WebSocket Stream Corruption and Jitter Test Suite
 * Senior SDET Automated Fault-Injection Specification
 */

const { test, expect } = require('@playwright/test');
const { WebSocketInterceptor } = require('./helpers/websocket-interceptor');
const { StateGuardian } = require('./helpers/state-guardian');

test.describe('WebSocket Stream Corruption and Jitter (Requirement A)', () => {

  test('A1: Intercept and drop every fourth incoming MARKET_UPDATE packet', async ({ page }) => {
    const interceptor = new WebSocketInterceptor({
      dropInterval: 4,
      enableDropping: true,
      enableJitter: false // Test pure packet dropping first
    });

    await interceptor.attach(page);

    const guardian = new StateGuardian({ timeoutMs: 15000 });
    await page.goto('/');

    // Wait for the application to synchronize despite packet loss
    const syncResult = await guardian.waitForSynchronization(page);
    expect(syncResult.success).toBe(true);

    // Await additional packets so multiple drop cycles complete
    await page.waitForFunction(() => {
      const diag = window.tradePulseDiagnostics ? window.tradePulseDiagnostics.getState() : null;
      return diag && diag.pointsCount >= 7;
    }, { timeout: 10000 });

    // Collect telemetry
    const metrics = interceptor.getMetrics();
    console.log('[TEST A1 METRICS]', {
      packetsReceived: metrics.packetsReceived,
      packetsDropped: metrics.packetsDropped,
      packetsForwarded: metrics.packetsForwarded,
      droppedSequences: metrics.droppedSequences
    });

    // Verification assertions
    expect(metrics.packetsReceived).toBeGreaterThanOrEqual(8);
    expect(metrics.packetsDropped).toBeGreaterThanOrEqual(2);
    expect(metrics.packetsForwarded).toBeGreaterThanOrEqual(6);

    // Verify deterministic drop ratio: packets dropped must equal floor(packetsReceived / 4)
    const expectedDrops = Math.floor(metrics.packetsReceived / 4);
    expect(metrics.packetsDropped).toBe(expectedDrops);

    // Verify dropped sequences are NEVER forwarded to the browser
    for (const droppedSeq of metrics.droppedSequences) {
      expect(metrics.forwardedSequences).not.toContain(droppedSeq);
    }

    // Verify browser state stayed consistent
    const browserDiag = await guardian.getDiagnostics(page);
    expect(browserDiag.appState.sync).toBe('true');
  });

  test('A2: Introduce variable network jitter (2,000ms - 7,000ms) with preserved ordering', async ({ page }) => {
    test.setTimeout(45000); // Allow sufficient time for delayed jittered packets

    const interceptor = new WebSocketInterceptor({
      dropInterval: 4,
      enableDropping: true,
      enableJitter: true,
      minJitterMs: 2000,
      maxJitterMs: 7000,
      jitterSchedule: [2200, 3100, 4500, 2600, 5800, 3400, 6200, 2500]
    });

    await interceptor.attach(page);
    const guardian = new StateGuardian({ timeoutMs: 30000 });

    await page.goto('/');

    // Wait for synchronization through the jitter buffer
    const syncResult = await guardian.waitForSynchronization(page);
    expect(syncResult.success).toBe(true);

    // Let a few more jittered packets arrive
    await page.waitForFunction(() => {
      const diag = window.tradePulseDiagnostics ? window.tradePulseDiagnostics.getState() : null;
      return diag && diag.sequence >= 6;
    }, { timeout: 25000 });

    const metrics = interceptor.getMetrics();
    console.log('[TEST A2 JITTER METRICS]', {
      packetsReceived: metrics.packetsReceived,
      packetsDropped: metrics.packetsDropped,
      packetsForwarded: metrics.packetsForwarded,
      averageLatency: metrics.averageLatency,
      maximumLatency: metrics.maximumLatency,
      sequenceGaps: metrics.sequenceGaps
    });

    // Verify jitter bounds
    expect(metrics.jitterApplied.length).toBeGreaterThan(0);
    for (const delay of metrics.jitterApplied) {
      expect(delay).toBeGreaterThanOrEqual(2000);
      expect(delay).toBeLessThanOrEqual(7000);
    }

    expect(metrics.averageLatency).toBeGreaterThanOrEqual(2000);
    expect(metrics.maximumLatency).toBeLessThanOrEqual(7000);

    // Verify message ordering is preserved (forwardedSequences strictly increasing)
    for (let i = 1; i < metrics.forwardedSequences.length; i++) {
      expect(metrics.forwardedSequences[i]).toBeGreaterThan(metrics.forwardedSequences[i - 1]);
    }

    // Verify sequence gaps exist due to dropped packets
    expect(metrics.sequenceGaps.length).toBeGreaterThanOrEqual(1);

    // Save full metrics evidence to evidence/websocket-metrics.json
    interceptor.saveMetrics('websocket-metrics.json');
  });

});
