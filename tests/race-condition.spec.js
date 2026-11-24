/**
 * Q1 Requirement C: Race Condition & Rapid Triple-Click Interceptor Test Suite
 * Senior SDET Timing & Concurrency Specification
 */

const { test, expect } = require('@playwright/test');
const { StateGuardian } = require('./helpers/state-guardian');
const { RaceConditionTester } = require('./helpers/race-condition');

test.describe('Race Condition and Triple-Click Attack (Requirement C)', () => {

  test('C1: Execute rapid triple-click attack in target 30ms - 120ms window post-render', async ({ page }) => {
    const guardian = new StateGuardian({ timeoutMs: 15000 });
    const raceTester = new RaceConditionTester({
      targetOffsetMs: 50, // 50ms, safely inside [30, 120]ms window
      minWindowMs: 30,
      maxWindowMs: 120
    });

    await page.goto('/');

    // 1. Wait for verified rendering synchronization
    const syncResult = await guardian.waitForSynchronization(page);
    expect(syncResult.success).toBe(true);

    // 2. Execute the triple click attack
    const attackReport = await raceTester.executeTripleClickAttack(page, '[data-testid="buy-button"]');

    console.log('[TEST C1 ATTACK REPORT]', {
      renderEventTimestamp: attackReport.renderEventTimestamp,
      firstClickTimestamp: attackReport.firstClickTimestamp,
      firstClickDelayMs: attackReport.firstClickDelayMs,
      inConfiguredWindow: attackReport.inConfiguredWindow,
      clickTimestamps: attackReport.clickTimestamps,
      requestsCount: attackReport.transactionRequestsCount,
      responsesCount: attackReport.transactionResponsesCount,
      duplicateDetected: attackReport.duplicateDetected,
      isConsistent: attackReport.isConsistent
    });

    // Verification:
    // 1. Interaction occurred within 30-120ms of rendering
    expect(attackReport.firstClickDelayMs).toBeGreaterThanOrEqual(30);
    expect(attackReport.firstClickDelayMs).toBeLessThanOrEqual(120);
    expect(attackReport.inConfiguredWindow).toBe(true);

    // 2. Exactly three clicks were dispatched
    expect(attackReport.clickTimestamps.length).toBe(3);

    // 3. Duplicate prevention: Exactly 1 transaction request was submitted to the backend
    expect(attackReport.transactionRequestsCount).toBe(1);
    expect(attackReport.duplicateDetected).toBe(false);

    // 4. UI visual state is consistent (accepted, not crashed)
    expect(attackReport.finalUiState.transactionResultClass).toContain('success');
    expect(attackReport.finalUiState.transactionResultText).toContain('Accepted: TP-');

    // Save report to evidence/race-condition-report.json
    raceTester.saveReport('race-condition-report.json');
  });

});
