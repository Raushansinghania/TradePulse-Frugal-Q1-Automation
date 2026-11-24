/**
 * Q1 Requirement E: Transaction Payload Distortion Attack Test Suite
 * Senior SDET Network Routing & Interception Specification
 */

const { test, expect } = require('@playwright/test');
const { StateGuardian } = require('./helpers/state-guardian');
const { saveEvidence } = require('./helpers/telemetry');

test.describe('Transaction Payload Distortion Attack (Requirement E)', () => {

  test('E1: Intercept outgoing transaction payload and inject malformed precision (0x123)', async ({ page }) => {
    const guardian = new StateGuardian({ timeoutMs: 15000 });
    const consoleLogs = [];
    page.on('console', msg => {
      consoleLogs.push({ type: msg.type(), text: msg.text() });
    });

    const interceptionTelemetry = {
      testTimestamp: new Date().toISOString(),
      originalPayload: null,
      modifiedPayload: null,
      mutatedField: 'precision',
      malformedValue: '0x123',
      serverStatusCode: null,
      serverResponsePayload: null,
      capturedConsoleErrors: [],
      uiFeedbackText: null,
      uiFeedbackClass: null,
      toastNotificationText: null,
      toastNotificationClass: null,
      safeRejectionVerified: false
    };

    // Arm Playwright network interception on /api/transaction
    await page.route('**/api/transaction', async (route) => {
      const originalBody = route.request().postData();
      const payload = JSON.parse(originalBody);

      interceptionTelemetry.originalPayload = { ...payload };

      // Verify original input before distortion
      expect(payload.precision).toBe('67450.00');
      expect(payload.quantity).toBe(0.001);
      expect(payload.action).toBe('BUY');

      // Distort mathematical precision to hexadecimal malformed string
      payload.precision = '0x123';
      interceptionTelemetry.modifiedPayload = { ...payload };

      const modifiedPostData = JSON.stringify(payload);
      console.log('[PAYLOAD-DISTORTION] Outgoing request mutated:', modifiedPostData);

      // Continue request with modified payload
      await route.continue({
        postData: modifiedPostData
      });
    });

    // Capture server response
    page.on('response', async (res) => {
      if (res.url().includes('/api/transaction')) {
        interceptionTelemetry.serverStatusCode = res.status();
        try {
          interceptionTelemetry.serverResponsePayload = await res.json();
        } catch (_) {}
      }
    });

    await page.goto('/');
    await guardian.waitForSynchronization(page);

    // Trigger the transaction from the UI
    const buyButton = page.locator('[data-testid="buy-button"]');
    await buyButton.click();

    // Await UI response settling
    const transactionResult = page.locator('#transactionResult');
    await expect(transactionResult).toContainText('Transaction rejected');

    const notification = page.locator('#notification');
    await expect(notification).toBeVisible();

    // Collect telemetry
    interceptionTelemetry.uiFeedbackText = await transactionResult.textContent();
    interceptionTelemetry.uiFeedbackClass = await transactionResult.getAttribute('class');
    interceptionTelemetry.toastNotificationText = await notification.textContent();
    interceptionTelemetry.toastNotificationClass = await notification.getAttribute('class');
    interceptionTelemetry.capturedConsoleErrors = consoleLogs.filter(c => c.type === 'error');

    console.log('[TEST E1 TELEMETRY]', {
      status: interceptionTelemetry.serverStatusCode,
      response: interceptionTelemetry.serverResponsePayload,
      uiResult: interceptionTelemetry.uiFeedbackText
    });

    // Verification:
    // 1. Proves request body was actually modified
    expect(interceptionTelemetry.originalPayload.precision).toBe('67450.00');
    expect(interceptionTelemetry.modifiedPayload.precision).toBe('0x123');

    // 2. Server rejected with HTTP 400 and PRECISION_VALIDATION_FAILED
    expect(interceptionTelemetry.serverStatusCode).toBe(400);
    expect(interceptionTelemetry.serverResponsePayload.success).toBe(false);
    expect(interceptionTelemetry.serverResponsePayload.code).toBe('PRECISION_VALIDATION_FAILED');
    expect(interceptionTelemetry.serverResponsePayload.error).toContain('Invalid mathematical precision');

    // 3. Observable safe behavior on UI (error status and toast, not silent failure)
    expect(interceptionTelemetry.uiFeedbackClass).toContain('error');
    expect(interceptionTelemetry.uiFeedbackText).toContain('Invalid mathematical precision');
    expect(interceptionTelemetry.toastNotificationClass).toContain('error');
    interceptionTelemetry.safeRejectionVerified = true;

    // Save evidence to evidence/payload-distortion.json
    saveEvidence('payload-distortion.json', interceptionTelemetry);
  });

  test('E2: Parameterized payload distortion (1e+7, 67450.123456789, non-numeric strings)', async ({ page }) => {
    const guardian = new StateGuardian({ timeoutMs: 15000 });
    const malformedCases = [
      { name: 'Scientific notation', value: '1e+7' },
      { name: 'Excessive precision decimals', value: '67450.123456789' },
      { name: 'Non-numeric string', value: 'INVALID_PRICE' }
    ];

    await page.goto('/');
    await guardian.waitForSynchronization(page);

    for (const testCase of malformedCases) {
      console.log(`[TEST E2] Testing distortion: ${testCase.name} -> "${testCase.value}"`);

      let serverStatus = null;
      let serverBody = null;

      const unroute = await page.route('**/api/transaction', async (route) => {
        const payload = JSON.parse(route.request().postData());
        payload.precision = testCase.value;
        await route.continue({ postData: JSON.stringify(payload) });
      });

      const responsePromise = page.waitForResponse(res => res.url().includes('/api/transaction'));
      await page.locator('[data-testid="buy-button"]').click();
      const res = await responsePromise;

      serverStatus = res.status();
      serverBody = await res.json();

      expect(serverStatus).toBe(400);
      expect(serverBody.success).toBe(false);
      expect(serverBody.code).toBe('PRECISION_VALIDATION_FAILED');

      await page.unroute('**/api/transaction');
    }
  });

  test('E3: Verify application continues to accept valid transactions after distortion', async ({ page }) => {
    const guardian = new StateGuardian({ timeoutMs: 15000 });
    await page.goto('/');
    await guardian.waitForSynchronization(page);

    // Ensure precision is valid
    await page.locator('#precision').fill('67450.00');
    await page.locator('#quantity').fill('0.001');

    const responsePromise = page.waitForResponse(res => res.url().includes('/api/transaction'));
    await page.locator('[data-testid="buy-button"]').click();
    const response = await responsePromise;

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.transactionId).toMatch(/^TP-\d+$/);

    const resultBox = page.locator('#transactionResult');
    await expect(resultBox).toHaveClass(/success/);
    await expect(resultBox).toContainText(`Accepted: ${body.transactionId}`);
  });

});
