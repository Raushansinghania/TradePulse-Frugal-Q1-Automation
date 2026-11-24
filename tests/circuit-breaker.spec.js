/**
 * Q1 Requirement D: Exponential Backoff Circuit Breaker Test Suite
 * Senior SDET Fault Tolerance Specification
 */

const { test, expect } = require('@playwright/test');
const { CircuitBreaker, CircuitState } = require('./helpers/circuit-breaker');
const { StateGuardian } = require('./helpers/state-guardian');

test.describe('Exponential Backoff Circuit Breaker (Requirement D)', () => {

  test('D1: Transient failure recovery with exponential backoff and coordinate recalculation', async ({ page }) => {
    const guardian = new StateGuardian({ timeoutMs: 15000 });
    await page.goto('/');
    await guardian.waitForSynchronization(page);

    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      initialDelayMs: 250,
      backoffMultiplier: 2,
      maxRetries: 3
    });

    let executionCount = 0;

    // Simulate an action that fails twice (transient coordinate/state drift), then recovers
    const result = await breaker.executeWithRetry(page, async ({ attempt, circuitState }) => {
      executionCount++;
      console.log(`[TEST D1] Action called: attempt ${attempt}, circuitState: ${circuitState}`);

      if (executionCount < 3) {
        throw new Error(`Transient coordinate mismatch error on attempt ${attempt}`);
      }

      // Successful action on attempt 2 (execution #3)
      const button = page.locator('[data-testid="buy-button"]');
      await button.click();
      return { success: true, executionCount };
    });

    console.log('[TEST D1 RECOVERY REPORT]', {
      outcome: result.outcome,
      recovered: result.recovered,
      finalState: breaker.getState(),
      history: breaker.retryHistory
    });

    // Verification:
    // 1. Initial state was CLOSED, transitioned to OPEN/HALF_OPEN, and recovered to CLOSED
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    expect(result.recovered).toBe(true);
    expect(result.outcome).toBe('SUCCESS');

    // 2. Verified retry progression delays: Attempt 1 -> 250ms, Attempt 2 -> 500ms
    const failureRecords = breaker.retryHistory.filter(h => h.failureReason);
    expect(failureRecords.length).toBe(2);
    expect(failureRecords[0].retryDelayMs).toBe(250);
    expect(failureRecords[1].retryDelayMs).toBe(500);

    // 3. Coordinate recalculation and synchronization recheck verified on each retry
    for (const rec of failureRecords) {
      expect(rec.recalculatedCoordinates).toBeDefined();
      expect(rec.recalculatedCoordinates.valid).toBe(true);
      expect(rec.recalculatedCoordinates.targetCoordinates.x).toBeGreaterThan(0);
      expect(rec.syncStatus.synchronized).toBe(true);
    }

    // Save report to evidence/circuit-breaker-report.json
    breaker.saveReport('circuit-breaker-report.json');
  });

  test('D2: Permanent failure safety: trips circuit breaker and halts unsafe retries', async ({ page }) => {
    const guardian = new StateGuardian({ timeoutMs: 15000 });
    await page.goto('/');
    await guardian.waitForSynchronization(page);

    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      initialDelayMs: 200,
      backoffMultiplier: 2,
      maxRetries: 3
    });

    let errorThrown = null;

    try {
      // Operation that permanently fails (unrecoverable state)
      await breaker.executeWithRetry(page, async ({ attempt }) => {
        throw new Error(`Permanent canvas context loss on attempt ${attempt}`);
      });
    } catch (err) {
      errorThrown = err;
    }

    console.log('[TEST D2 PERMANENT FAILURE REPORT]', {
      error: errorThrown?.message,
      finalState: breaker.getState(),
      summary: breaker.report
    });

    // Verification:
    // 1. Maximum retries exhausted and error thrown
    expect(errorThrown).toBeDefined();
    expect(errorThrown.message).toContain('exhausted maximum retries');

    // 2. Circuit breaker state remains OPEN to prevent further damage
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    // 3. Further interaction attempts are immediately blocked while OPEN
    await expect(breaker.executeWithRetry(page, async () => {
      return { unsafe: true };
    })).rejects.toThrow(/CircuitBreaker is OPEN/);
  });

});
