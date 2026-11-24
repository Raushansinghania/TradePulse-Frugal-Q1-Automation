/**
 * Race Condition & Rapid Triple-Click Interceptor
 * Senior SDET Timing Engine for TradePulse Q1
 *
 * Dispatches a rapid 3-click burst within the required 30ms-120ms window
 * following the tradepulse:rendered synchronization event.
 * Uses performance.now() and browser event triggers — NO static sleeps.
 */

const { saveEvidence } = require('./telemetry');

class RaceConditionTester {
  constructor(options = {}) {
    this.targetOffsetMs = options.targetOffsetMs || 45; // Default 45ms, well within 30-120ms window
    this.minWindowMs = options.minWindowMs || 30;
    this.maxWindowMs = options.maxWindowMs || 120;
    this.report = null;
  }

  /**
   * Arm transaction network request tracking in Playwright.
   */
  trackRequests(page) {
    const transactions = {
      requests: [],
      responses: []
    };

    page.on('request', (req) => {
      if (req.url().includes('/api/transaction')) {
        transactions.requests.push({
          url: req.url(),
          method: req.method(),
          postData: req.postData(),
          timestamp: Date.now()
        });
      }
    });

    page.on('response', (res) => {
      if (res.url().includes('/api/transaction')) {
        transactions.responses.push({
          url: res.url(),
          status: res.status(),
          timestamp: Date.now()
        });
      }
    });

    return transactions;
  }

  /**
   * Execute the triple click within 30-120ms after tradepulse:rendered event.
   */
  async executeTripleClickAttack(page, targetSelector = '[data-testid="buy-button"]') {
    const tracker = this.trackRequests(page);

    const timingResult = await page.evaluate(async ({ selector, targetOffset, minWin, maxWin }) => {
      return new Promise((resolve, reject) => {
        let fired = false;

        function runAttack(renderTimestamp, eventDetail) {
          if (fired) return;
          fired = true;

          const button = document.querySelector(selector);
          if (!button) {
            reject(new Error(`Target button selector "${selector}" not found in DOM`));
            return;
          }

          // Spin-wait with performance.now() to hit exact target offset within [30, 120] ms
          function waitForWindow() {
            const now = performance.now();
            const elapsed = now - renderTimestamp;

            if (elapsed < targetOffset) {
              requestAnimationFrame(waitForWindow);
              return;
            }

            // Target reached! Execute 3 rapid clicks
            const clickTimestamps = [];

            // Click 1
            const c1Time = performance.now();
            clickTimestamps.push(c1Time);
            button.click();

            // Click 2 (microsecond gap)
            const c2Time = performance.now();
            clickTimestamps.push(c2Time);
            button.click();

            // Click 3
            const c3Time = performance.now();
            clickTimestamps.push(c3Time);
            button.click();

            const firstClickDelay = Math.round((c1Time - renderTimestamp) * 100) / 100;
            const inWindow = firstClickDelay >= minWin && firstClickDelay <= maxWin;

            resolve({
              renderEventTimestamp: renderTimestamp,
              firstClickTimestamp: c1Time,
              firstClickDelayMs: firstClickDelay,
              clickTimestamps,
              inConfiguredWindow: inWindow,
              targetOffsetConfigured: targetOffset,
              allowedWindow: { min: minWin, max: maxWin },
              eventDetail,
              buttonDisabledAfterBurst: button.disabled
            });
          }

          requestAnimationFrame(waitForWindow);
        }

        // Check if render event already fired recently or listen for the next one
        if (window.__lastTradePulseRenderAt && (performance.now() - window.__lastTradePulseRenderAt < 500)) {
          runAttack(window.__lastTradePulseRenderAt, { fromCache: true });
        } else {
          window.addEventListener('tradepulse:rendered', (e) => {
            const renderTimestamp = window.__lastTradePulseRenderAt || performance.now();
            runAttack(renderTimestamp, e.detail);
          }, { once: true });
        }
      });
    }, {
      selector: targetSelector,
      targetOffset: this.targetOffsetMs,
      minWin: this.minWindowMs,
      maxWin: this.maxWindowMs
    });

    // Wait for the UI transaction state to settle (using locator state, no static sleep)
    const resultElement = page.locator('#transactionResult');
    await resultElement.waitFor({ state: 'visible' });

    // Ensure fetch promise completed
    await page.waitForFunction(() => {
      const el = document.getElementById('transactionResult');
      return el && !el.textContent.includes('Validating transaction...');
    }, { timeout: 10000 });

    const finalUiState = await page.evaluate(() => {
      return {
        transactionResultText: document.getElementById('transactionResult')?.textContent,
        transactionResultClass: document.getElementById('transactionResult')?.className,
        notificationText: document.getElementById('notification')?.textContent,
        notificationClass: document.getElementById('notification')?.className,
        buyButtonDisabled: document.getElementById('buyButton')?.disabled
      };
    });

    this.report = {
      testTimestamp: new Date().toISOString(),
      ...timingResult,
      transactionRequestsCount: tracker.requests.length,
      transactionResponsesCount: tracker.responses.length,
      requestsPayloads: tracker.requests,
      responsesPayloads: tracker.responses,
      finalUiState,
      duplicateDetected: tracker.requests.length > 1,
      isConsistent: tracker.requests.length === 1 && !finalUiState.transactionResultClass.includes('error')
    };

    return this.report;
  }

  saveReport(filename = 'race-condition-report.json') {
    if (!this.report) {
      throw new Error('No race condition report available. Execute attack first.');
    }
    return saveEvidence(filename, this.report);
  }
}

module.exports = {
  RaceConditionTester
};
