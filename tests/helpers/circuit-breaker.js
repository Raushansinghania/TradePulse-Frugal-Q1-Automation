/**
 * Exponential Backoff Circuit Breaker
 * Senior SDET Fault-Tolerance Engine for TradePulse Q1
 *
 * Implements tri-state machine (CLOSED, OPEN, HALF_OPEN) with dynamic
 * coordinate recalculation, synchronization re-checking, and bounded backoff.
 */

const { saveEvidence } = require('./telemetry');

const CircuitState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 3;
    this.initialDelayMs = options.initialDelayMs || 250;
    this.backoffMultiplier = options.backoffMultiplier || 2;
    this.maxDelayMs = options.maxDelayMs || 2000;
    this.maxRetries = options.maxRetries || 4;

    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.retryHistory = [];
    this.report = null;
  }

  getState() {
    return this.state;
  }

  /**
   * Recalculates canvas dimensions and interactive point coordinates.
   */
  async recalculateCanvasCoordinates(page, canvasSelector = '#priceChart') {
    return await page.evaluate((selector) => {
      const canvas = document.querySelector(selector);
      if (!canvas) {
        return { valid: false, error: 'Canvas element not found' };
      }
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const padding = 35;

      // Price point coordinate (latest price point)
      const targetX = Math.round(rect.left + rect.width - padding);
      const targetY = Math.round(rect.top + rect.height / 2);

      return {
        valid: rect.width > 0 && rect.height > 0,
        rect: {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        devicePixelRatio: dpr,
        targetCoordinates: { x: targetX, y: targetY },
        timestamp: performance.now()
      };
    }, canvasSelector);
  }

  /**
   * Rechecks that the application is in synchronized state before retry.
   */
  async recheckSynchronization(page) {
    return await page.evaluate(() => {
      const appState = document.getElementById('appState');
      const diag = window.tradePulseDiagnostics ? window.tradePulseDiagnostics.getState() : null;
      return {
        synchronized: appState?.dataset.stateSync === 'true',
        state: appState?.dataset.state,
        rendered: appState?.dataset.rendered === 'true',
        connectionOpen: diag ? diag.connection : false,
        sequence: diag ? diag.sequence : 0
      };
    });
  }

  /**
   * Execute an operation with circuit-breaker protection and exponential backoff retry.
   */
  async executeWithRetry(page, operationFn, context = {}) {
    let attempt = 0;
    const executionId = `CB-${Date.now()}`;

    while (attempt <= this.maxRetries) {
      // If OPEN and past retries, block execution
      if (this.state === CircuitState.OPEN && attempt === 0) {
        throw new Error('CircuitBreaker is OPEN: interactions temporarily halted to prevent unsafe transactions.');
      }

      // If retrying, we are in HALF_OPEN (probing stability)
      if (attempt > 0) {
        this.state = CircuitState.HALF_OPEN;
      }

      try {
        // Execute probe or action
        const result = await operationFn({
          attempt,
          circuitState: this.state,
          context
        });

        // If successful in HALF_OPEN or CLOSED, reset and close circuit
        const previousState = this.state;
        this.state = CircuitState.CLOSED;
        this.consecutiveFailures = 0;

        const record = {
          executionId,
          attempt,
          previousState,
          finalState: this.state,
          outcome: 'SUCCESS',
          recovered: previousState === CircuitState.HALF_OPEN,
          result
        };
        this.retryHistory.push(record);
        this.report = record;
        return record;

      } catch (err) {
        attempt++;
        this.consecutiveFailures++;

        // Determine retry delay using exponential progression
        const delay = Math.min(
          this.initialDelayMs * Math.pow(this.backoffMultiplier, attempt - 1),
          this.maxDelayMs
        );

        if (this.consecutiveFailures >= this.failureThreshold) {
          this.state = CircuitState.OPEN;
        }

        console.warn(`[CIRCUIT-BREAKER] Failure #${this.consecutiveFailures} (Attempt ${attempt}): ${err.message}. Retrying in ${delay}ms...`);

        // Recalculate coordinates and recheck sync before retry
        let coords = null;
        let syncStatus = null;
        try {
          coords = await this.recalculateCanvasCoordinates(page);
          syncStatus = await this.recheckSynchronization(page);
        } catch (_) {}

        const failureRecord = {
          executionId,
          attempt,
          circuitState: this.state,
          failureReason: err.message,
          retryDelayMs: delay,
          recalculatedCoordinates: coords,
          syncStatus,
          timestamp: Date.now()
        };
        this.retryHistory.push(failureRecord);

        if (attempt > this.maxRetries) {
          this.state = CircuitState.OPEN;
          this.report = {
            executionId,
            finalState: CircuitState.OPEN,
            outcome: 'PERMANENT_FAILURE',
            totalAttempts: attempt,
            consecutiveFailures: this.consecutiveFailures,
            lastError: err.message,
            history: this.retryHistory
          };
          throw new Error(`CircuitBreaker exhausted maximum retries (${this.maxRetries}). State remained OPEN. Last error: ${err.message}`);
        }

        // Bounded event-driven delay
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  saveReport(filename = 'circuit-breaker-report.json') {
    return saveEvidence(filename, {
      finalState: this.state,
      consecutiveFailures: this.consecutiveFailures,
      summary: this.report,
      history: this.retryHistory
    });
  }
}

module.exports = {
  CircuitBreaker,
  CircuitState
};
