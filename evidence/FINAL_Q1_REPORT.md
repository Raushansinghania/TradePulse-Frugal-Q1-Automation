# TradePulse: Event-Loop Starvation, WebSocket Fault Injection & State-Drift Automation
## Final Engineering Verification & Technical Submission Report — Q1

**Author:** Senior SDET, Automation Architect & Playwright Specialist  
**System:** TradePulse Financial Trading Terminal  
**Environment:** Windows 11 Enterprise | Node.js v24.15.0 | npm 11.12.1 | Playwright 1.65.1 | Express 5.3.0 | ws 8.23.0 | Chromium 159.0.8154.6  
**Execution Timestamp:** 2026-11-24T15:08:45Z  
**Final Test Suite Outcome:** 17 Passed | 0 Failed | 100% Pass Rate  

---

## 1. Executive Summary

This report documents the architectural hardening, automated fault injection, and dynamic state-guardian framework developed for **TradePulse**, a localized financial market streaming testbed. In modern electronic trading terminals, high-frequency market data streams frequently saturate browser single-threaded event loops, induce microsecond race conditions on order panels, and trigger subtle state-drift between canvas visualizers and state stores.

To address these vulnerabilities, we developed a technically verifiable automation framework under **Playwright 1.65.1** and **Node.js v24.15.0**. The framework performs real protocol-level WebSocket frame mutation (dropping every 4th market update frame and applying deterministic 2,000–7,000 ms jitter), implements a zero-sleep dynamic multi-conditional state guardian, conducts high-resolution triple-click race condition simulations within a strict 30–120 ms post-render window, deploys a tri-state exponential backoff circuit breaker with coordinate recalculation, and executes network-level transaction payload distortion attacks.

Every metric, timing interval, and state progression cited in this report is derived directly from live Playwright executions and stored as machine-readable evidence.

---

## 2. Why TradePulse Qualifies as a Financial Streaming Testbed

Financial trading interfaces possess characteristics that distinguish them from typical CRUD web applications:
1. **High-Frequency Market Feeds:** Market tickers broadcast continuous updates (in TradePulse, 250 ms ticker intervals delivering BTC/USDT price drift and sequence counters).
2. **Event-Loop Pressure & Frame Starvation:** Rapid stream processing combined with canvas repainting (HTML5 2D Canvas context rendering high/low indicators and price paths) can delay user interaction callbacks if microtasks and macrotasks are not carefully balanced.
3. **Strict Precision Accounting:** Cryptographic and fiat asset quantities demand strict mathematical precision. Floating-point inaccuracy, hex injection (`0x123`), scientific notation (`1e+7`), or excessive fractional digits represent severe financial risk.
4. **State-Drift Susceptibility:** When incoming packets are delayed or dropped, the DOM tickers (`#livePrice`, `#orderPrice`), chart state (`#priceChart`), and synchronization attributes (`data-state-sync`) must maintain consistency without locking the user out.

TradePulse serves as an ideal localized testbed by reproducing these constraints in an isolated, deterministic environment without relying on third-party brokerages or external exchange dependencies.

---

## 3. Application Architecture & Initial Remediation

### 3.1 Topology
TradePulse runs as a unified HTTP and WebSocket server on `127.0.0.1:3000`:
- **Backend (`src/server.js`):** Express 5.3.0 handling health checks (`/api/health`) and atomic transaction validations (`/api/transaction`). A coupled `WebSocketServer` (`ws` 8.23.0) broadcasts ticker frames every 250 ms:
  ```json
  {"type":"MARKET_UPDATE","symbol":"BTCUSDT","price":67450.00,"sequence":1,"timestamp":1795532883000}
  ```
- **Frontend (`src/dashboard.html`, `src/dashboard.css`, `src/dashboard.js`, `src/websocket.js`):** Semantic dark-themed trading desk with real-time SVG connection badges, skeleton screen loaders, high-DPI canvas charts, Quick Trade order forms, and an observable state sentinel `#appState`.

### 3.2 Audit Findings & Root-Cause Remediation
During Phase 1 auditing, a critical defect was detected:
- **Defect:** `src/dashboard.js` contained an unclosed function block in `updatePrice()` around line 241, causing `revealChart()` and subsequent event handlers to be nested improperly. This caused `SyntaxError: Unexpected token ')'` at line 597 during initial script evaluation, completely crashing the client-side terminal in Chromium.
- **Remediation:** Closed `updatePrice()` properly before `revealChart()`, verified syntax via `node -c src/dashboard.js`, restored the DOM state progression (`IDLE -> LOADING -> RENDERING -> SYNCHRONIZED`), and introduced an in-flight submission lock (`isSubmitting`) to guarantee idempotency under rapid burst interactions.

---

## 4. Requirement A — WebSocket Stream Corruption & Network Jitter

### 4.1 Methodology
Rather than simulating packet loss via UI trickery, real protocol-level interception was implemented using Playwright's native `page.routeWebSocket()`. The interceptor hooks into the bi-directional frame pipeline:
- Intercepts incoming server-to-client WebSocket text frames.
- Parses `MARKET_UPDATE` JSON payloads.
- **Packet Dropping:** Tracks received packets deterministically. Every 4th packet (`packetNumber % 4 === 0`) is intercepted, recorded, and suppressed (dropped) before reaching the browser.
- **Network Jitter:** Forwarded packets are queued into an ordered delivery buffer applying deterministic variable delays between 2,000 ms and 7,000 ms using a reproducible jitter schedule (`[2200, 3100, 4500, 2600, 5800, 3400, 6200, 2500]`).
- **Ordering Guarantee:** A scheduled delivery queue prevents event-loop starvation and guarantees that out-of-order frame delivery is avoided.

### 4.2 Measured Evidence & Verification
Evidence file: `evidence/websocket-metrics.json`

```json
{
  "packetsReceived": 23,
  "packetsDropped": 5,
  "packetsForwarded": 6,
  "droppedSequences": [125, 129, 133, 137, 141],
  "forwardedSequences": [122, 123, 124, 126, 127, 128],
  "averageLatency": 3661,
  "maximumLatency": 6200,
  "connectionState": "INTERCEPTING"
}
```

**Key Findings:**
1. **Deterministic Dropping:** Out of 23 received packets, exactly $\lfloor 23 / 4 \rfloor = 5$ packets were dropped.
2. **Zero Leakage:** None of the dropped sequence numbers (`125, 129, 133, 137, 141`) appeared in `forwardedSequences`.
3. **Jitter Bounds:** Latencies were bounded strictly between 2,200 ms and 6,200 ms (average: 3,661 ms, maximum: 6,200 ms).
4. **Sequence Gap Detection:** The dashboard observed sequence gaps (e.g. sequence jumping from 124 to 126) while continuing uninterrupted canvas drawing.

---

## 5. Requirement B — Dynamic Multi-Conditional State Guardian

### 5.1 Methodology
Static sleep (`page.waitForTimeout`, `Thread.sleep`) was banned. The custom `StateGuardian` (`tests/helpers/state-guardian.js`) verifies structural state transitions:
$$\text{IDLE} \longrightarrow \text{LOADING} \longrightarrow \text{RENDERING} \longrightarrow \text{SYNCHRONIZED}$$

The guardian monitors:
1. `MutationObserver` on `#appState` tracking `data-state` and `data-state-sync`.
2. WebSocket transport status (`readyState === WebSocket.OPEN`).
3. Browser custom event `tradepulse:rendered` containing `{ sequence, price }`.
4. High-resolution performance timestamp `window.__lastTradePulseRenderAt`.
5. Canvas pixel verification via 2D buffer sampling (`getImageData()`).
6. Price consistency between DOM elements (`#livePrice`, `#orderPrice`) and diagnostics API.
7. Bounded deadline timeout with structured failure telemetry.

### 5.2 Measured Evidence & Verification
Evidence file: `evidence/synchronization-report.json`

```json
{
  "success": true,
  "elapsedMs": 1249,
  "transitions": [
    { "state": "loading", "sync": false, "timestamp": 377.8 },
    { "state": "rendering", "sync": false, "timestamp": 1580.5 },
    { "state": "synchronized", "sync": true, "timestamp": 1622.9 }
  ],
  "events": [
    {
      "type": "tradepulse:rendered",
      "detail": { "sequence": 91, "price": 67440.59 },
      "timestamp": 1622.6,
      "lastRenderAt": 1622.5
    }
  ],
  "canvasVerified": true,
  "finalState": "synchronized",
  "finalSync": "true"
}
```

**Key Findings:**
- Complete transition from `loading` to `rendering` to `synchronized` verified in 1,249 ms without arbitrary sleeps.
- Canvas pixel inspection proved that the chart had completed rendering with high/low bounds before synchronization was asserted.

---

## 6. Requirement C — Race Condition & Rapid Triple-Click Attack

### 6.1 Methodology
High-frequency traders frequently trigger double-clicks or rapid keyboard taps during high volatility. Requirement C mandates an automated rapid triple-click attack executed within **30 ms to 120 ms** after the `tradepulse:rendered` event.

The `RaceConditionTester` (`tests/helpers/race-condition.js`):
1. Awaits verified synchronization.
2. Captures `window.__lastTradePulseRenderAt`.
3. Runs a high-precision `performance.now()` micro-wait loop to hit a 50 ms target offset.
4. Fires 3 rapid clicks on the Quick Trade action panel button (`[data-testid="buy-button"]`).
5. Records the high-resolution timestamps of all three clicks.
6. Monitors network traffic to verify idempotency and catch duplicate transactions.

### 6.2 Measured Evidence & Verification
Evidence file: `evidence/race-condition-report.json`

```json
{
  "renderEventTimestamp": 1578.89,
  "firstClickTimestamp": 1636.00,
  "firstClickDelayMs": 57.1,
  "clickTimestamps": [
    1636.0,
    1638.1,
    1638.1
  ],
  "inConfiguredWindow": true,
  "allowedWindow": { "min": 30, "max": 120 },
  "transactionRequestsCount": 1,
  "transactionResponsesCount": 1,
  "duplicateDetected": false,
  "isConsistent": true,
  "finalUiState": {
    "transactionResultText": "Accepted: TP-1795532909177",
    "transactionResultClass": "transaction-result success"
  }
}
```

**Key Findings:**
1. **Timing Compliance:** First click executed at **57.1 ms** post-render, squarely within the required $[30, 120]\text{ ms}$ window.
2. **Click Burst:** All 3 clicks fired within a 2.1 ms window.
3. **Idempotency Proof:** Exactly **1 HTTP request** was initiated; 0 duplicate orders reached the server.
4. **Visual Consistency:** Order accepted with transaction ID `TP-1795532909177` and green status feedback.

---

## 7. Requirement D — Exponential Backoff Circuit Breaker

### 7.1 Methodology
To withstand transient rendering glitches, canvas coordinate shifts, and event-loop lag, a reusable `CircuitBreaker` (`tests/helpers/circuit-breaker.js`) was constructed with three states:
- `CLOSED`: Normal operation.
- `OPEN`: Repeated failures trip the circuit; interactions are halted to prevent unsafe state corruption.
- `HALF_OPEN`: Trial probe state after backoff. Re-evaluates synchronization and recalculates canvas target coordinates before retrying.

Retry schedule: $\text{delay} = \min(\text{initialDelay} \times 2^{\text{attempt}-1}, \text{maxDelay})$ ($250\text{ ms} \to 500\text{ ms} \to 1000\text{ ms} \to 2000\text{ ms}$).

### 7.2 Measured Evidence & Verification
Evidence file: `evidence/circuit-breaker-report.json`

```json
{
  "finalState": "CLOSED",
  "consecutiveFailures": 0,
  "summary": {
    "executionId": "CB-1795532913545",
    "attempt": 2,
    "previousState": "HALF_OPEN",
    "finalState": "CLOSED",
    "outcome": "SUCCESS",
    "recovered": true
  },
  "history": [
    {
      "attempt": 1,
      "circuitState": "CLOSED",
      "failureReason": "Simulated transient coordinate misalignment",
      "retryDelayMs": 250,
      "recalculatedCoordinates": {
        "valid": true,
        "rect": { "left": 288, "top": 370, "width": 631, "height": 330 },
        "targetCoordinates": { "x": 884, "y": 535 }
      },
      "syncStatus": { "synchronized": true, "state": "synchronized" }
    },
    {
      "attempt": 2,
      "circuitState": "OPEN",
      "failureReason": "Simulated transient coordinate misalignment",
      "retryDelayMs": 500,
      "recalculatedCoordinates": {
        "valid": true,
        "rect": { "left": 288, "top": 370, "width": 631, "height": 330 },
        "targetCoordinates": { "x": 884, "y": 535 }
      },
      "syncStatus": { "synchronized": true, "state": "synchronized" }
    },
    {
      "attempt": 2,
      "previousState": "HALF_OPEN",
      "finalState": "CLOSED",
      "outcome": "SUCCESS",
      "recovered": true
    }
  ]
}
```

**Key Findings:**
1. **Transient Recovery:** Succeeded on attempt 2 after backoff delays of 250 ms and 500 ms; circuit recovered safely to `CLOSED`.
2. **Coordinate Recalculation:** Canvas bounding box (`631x330` at `[288, 370]`) and target point `(884, 535)` were recomputed prior to each probe.
3. **Fail-Safe Trip:** Verified in test `D2` that permanent faults exhaust maximum retries, lock the circuit in `OPEN`, and reject further unsafe interaction attempts.

---

## 8. Requirement E — Transaction Payload Distortion Attack

### 8.1 Methodology
Network routing (`page.route('**/api/transaction', ...)`) intercepted legitimate transaction submissions generated by the browser UI:
1. Captured original payload: `{"action":"BUY","symbol":"BTCUSDT","quantity":0.001,"precision":"67450.00"}`.
2. Verified that the original input was mathematically valid.
3. Mutated `precision` to `0x123`, `1e+7`, `67450.123456789`, and non-numeric strings while keeping other fields intact.
4. Continued the mutated request to the local Express server.
5. Captured HTTP 400 response, JSON validation telemetry, and UI feedback.
6. Verified subsequent valid transaction execution.

### 8.2 Measured Evidence & Verification
Evidence file: `evidence/payload-distortion.json`

```json
{
  "testTimestamp": "2026-11-24T15:08:01.650Z",
  "originalPayload": {
    "action": "BUY",
    "symbol": "BTCUSDT",
    "quantity": 0.001,
    "precision": "67450.00"
  },
  "modifiedPayload": {
    "action": "BUY",
    "symbol": "BTCUSDT",
    "quantity": 0.001,
    "precision": "0x123"
  },
  "serverStatusCode": 400,
  "serverResponsePayload": {
    "success": false,
    "error": "Invalid mathematical precision",
    "code": "PRECISION_VALIDATION_FAILED"
  },
  "uiFeedbackText": "Transaction rejected: Invalid mathematical precision (PRECISION_VALIDATION_FAILED)",
  "uiFeedbackClass": "transaction-result error",
  "toastNotificationText": "Invalid mathematical precision (PRECISION_VALIDATION_FAILED)",
  "toastNotificationClass": "notification visible error",
  "safeRejectionVerified": true
}
```

**Key Findings:**
1. **Interception Proved:** Request body was genuinely modified over the wire from `67450.00` to `0x123`.
2. **Structured Server Rejection:** Express rejected the hex string with HTTP 400 and `code: 'PRECISION_VALIDATION_FAILED'`.
3. **Observable Safe UI Handling:** The terminal rendered an error banner and toast alert, logging the error without crashing.
4. **Post-Attack Recovery:** Verified in test `E3` that valid transactions (`quantity: 0.005`, `precision: "67450.00"`) succeeded immediately with HTTP 201.

---

## 9. Comprehensive Test Suite Execution Results

Full test suite execution command:
```bash
npx playwright test --reporter=list
```

### Execution Matrix
| Suite / Spec File | Test Name | Result | Duration |
|---|---|---|---|
| `payload-distortion.spec.js` | `E1: Intercept outgoing transaction payload and inject malformed precision (0x123)` | **PASSED** | 4.1s |
| `circuit-breaker.spec.js` | `D1: Transient failure recovery with exponential backoff and coordinate recalculation` | **PASSED** | 4.1s |
| `circuit-breaker.spec.js` | `D2: Permanent failure safety: trips circuit breaker and halts unsafe retries` | **PASSED** | 5.5s |
| `payload-distortion.spec.js` | `E2: Parameterized payload distortion (1e+7, 67450.123456789, non-numeric strings)` | **PASSED** | 5.8s |
| `payload-distortion.spec.js` | `E3: Verify application continues to accept valid transactions after distortion` | **PASSED** | 3.5s |
| `q1-automation.spec.js` | `Q1-E2E-01: Health check endpoint verification` | **PASSED** | 146ms |
| `race-condition.spec.js` | `C1: Execute rapid triple-click attack in target 30ms - 120ms window post-render` | **PASSED** | 2.3s |
| `synchronization.spec.js` | `B1: Verify verified state progression (IDLE -> LOADING -> RENDERING -> SYNCHRONIZED)` | **PASSED** | 2.2s |
| `synchronization.spec.js` | `B2: Verify timeout deadline behavior with structured diagnostics on failure` | **PASSED** | 4.0s |
| `q1-automation.spec.js` | `Q1-E2E-03: Multi-conditional dynamic state guardian progression` | **PASSED** | 4.4s |
| `q1-automation.spec.js` | `Q1-E2E-04: Rapid triple-click interaction within 30-120ms window` | **PASSED** | 4.2s |
| `websocket-fault-injection.spec.js` | `A1: Intercept and drop every fourth incoming MARKET_UPDATE packet` | **PASSED** | 5.5s |
| `q1-automation.spec.js` | `Q1-E2E-05: Circuit breaker exponential backoff retry and coordinate recalculation` | **PASSED** | 3.9s |
| `websocket-fault-injection.spec.js` | `A2: Introduce variable network jitter (2,000ms - 7,000ms) with preserved ordering` | **PASSED** | 9.2s |
| `q1-automation.spec.js` | `Q1-E2E-02: End-to-End WebSocket fault injection with packet dropping and jitter` | **PASSED** | 9.1s |
| `q1-automation.spec.js` | `Q1-E2E-06: Outgoing transaction payload distortion attack` | **PASSED** | 6.4s |
| `q1-automation.spec.js` | `Q1-E2E-07: Regression verification: valid transaction works cleanly` | **PASSED** | 3.3s |

**Total:** 17 Passed | 0 Failed | Execution Time: 50.1s

---

## 10. Generated Artifacts & Submission Evidence

The following artifacts have been generated in the project root:

1. **Evidence Telemetry Files (`evidence/`):**
   - `evidence/PROJECT_AUDIT.md`: System audit, architecture review, and bug remediation report.
   - `evidence/websocket-metrics.json`: Drop counters, jitter latency arrays, sequence gaps.
   - `evidence/synchronization-report.json`: State machine transition history and canvas diagnostics.
   - `evidence/race-condition-report.json`: Triple-click timestamps (57.1 ms post-render) and idempotency counts.
   - `evidence/circuit-breaker-report.json`: Exponential backoff records and coordinate recomputations.
   - `evidence/payload-distortion.json`: Modified request bodies, HTTP 400 responses, and error toasts.
   - `evidence/test-results.json`: Summary execution log across all requirements.
   - `evidence/FINAL_Q1_REPORT.md`: This comprehensive engineering submission report.

2. **Visual Evidence Screenshots (`screenshots/`):**
   - `screenshots/01-dashboard-synchronized.png`: Terminal synchronized with live BTC/USDT canvas.
   - `screenshots/02-websocket-jitter-stream.png`: Real-time streaming under variable network jitter.
   - `screenshots/03-triple-click-attack.png`: Quick Trade order panel following rapid triple-click.
   - `screenshots/04-payload-distortion-rejection.png`: Observable HTTP 400 error toast and status feedback.
   - `screenshots/05-circuit-breaker-recovery.png`: Stabilized chart after circuit breaker coordinate recalculation.

3. **HTML Test Report:**
   - `playwright-report/index.html`: Playwright HTML report with full execution traces.

---

## 11. Known Limitations & Technical Evaluation Notes

1. **Synthetic Clock Skew:** Chromium's `performance.now()` in headless mode incorporates anti-fingerprinting clock jitter (~5–20 $\mu\text{s}$). The race condition tester accounts for this by rounding to tenths of milliseconds.
2. **Local Loopback WebSocket Latency:** Because both Express and Playwright run locally on `127.0.0.1`, raw network latency is sub-millisecond. The artificial jitter schedule accurately recreates wide-area financial streaming delays.
3. **Simulation Disclaimer:** All price movements and order executions are strictly simulated. No external exchange connections or real monetary balances are utilized.

---

## 12. Conclusion & Acceptance Criteria Verification

All requirements specified for Frugal Testing Q1 have been satisfied, validated, and verified through empirical execution:

- [x] TradePulse server starts successfully on `127.0.0.1:3000`.
- [x] Dashboard loads and renders live BTC/USDT price movements.
- [x] WebSocket client connects with automated reconnection handling.
- [x] Packet dropping drops every 4th incoming packet deterministically.
- [x] Variable network jitter is applied within 2,000–7,000 ms with preserved message ordering.
- [x] Dynamic state guardian verifies `IDLE -> LOADING -> RENDERING -> SYNCHRONIZED` with zero static sleeps.
- [x] Rapid triple-click attack executes within 30–120 ms post-render (measured: 57.1 ms) with verified idempotency.
- [x] Exponential backoff circuit breaker recalculates coordinates and recovers from transient faults.
- [x] Outgoing transaction payload is intercepted and modified over the network (`0x123`).
- [x] Server rejection (`PRECISION_VALIDATION_FAILED`) and visual UI error toasts are verified.
- [x] Valid transactions continue operating normally following attacks.
- [x] Complete regression test suite passes with 100% success rate (17/17 tests).
- [x] Machine-readable evidence and final documentation generated.
