# TradePulse: Financial Streaming & Fault-Injection Automation Testbed
### Frugal Testing — AI-Native Software Engineer Intern Assignment (Q1)

[![Playwright](https://img.shields.io/badge/Playwright-1.65.1-green.svg)](https://playwright.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-v24.15.0-blue.svg)](https://nodejs.org/)
[![Status](https://img.shields.io/badge/Test%20Suite-17%2F17%20Passed-success.svg)]()

TradePulse is a localized financial market streaming testbed designed to evaluate browser event-loop resiliency, WebSocket fault-injection, rapid interaction race conditions, state-drift synchronization, and network payload distortion.

---

## 1. Quick Start & Execution

### Prerequisites
- Windows 11 / Linux / macOS
- Node.js `v20+` (tested on Node.js `v24.15.0`)
- npm `v10+` (tested on npm `11.12.1`)

### Installation
```bash
npm install
```

### Running the Application
```bash
npm start
```
Terminal will be available at:
- **Dashboard:** [http://127.0.0.1:3000](http://127.0.0.1:3000)
- **Health Check:** [http://127.0.0.1:3000/api/health](http://127.0.0.1:3000/api/health)
- **WebSocket Endpoint:** `ws://127.0.0.1:3000`

---

## 2. Running the Test Suite

Execute the complete Playwright automated test suite:

```bash
# Run all tests with list reporter
npx playwright test --reporter=list

# Or run via npm script
npm test

# View interactive HTML report
npm run test:report
```

### Running Individual Test Suites
```bash
# Requirement A: WebSocket Fault Injection & Jitter
npx playwright test tests/websocket-fault-injection.spec.js --reporter=list

# Requirement B: Dynamic Multi-Conditional State Guardian
npx playwright test tests/synchronization.spec.js --reporter=list

# Requirement C: Race Condition & Triple-Click Attack
npx playwright test tests/race-condition.spec.js --reporter=list

# Requirement D: Exponential Backoff Circuit Breaker
npx playwright test tests/circuit-breaker.spec.js --reporter=list

# Requirement E: Transaction Payload Distortion Attack
npx playwright test tests/payload-distortion.spec.js --reporter=list

# Master Regression Suite
npx playwright test tests/q1-automation.spec.js --reporter=list
```

---

## 3. Architecture & Q1 Engineering Highlights

```
Frugal_Testing_Assignment/
├── evidence/                          # Machine-readable test telemetry
│   ├── PROJECT_AUDIT.md               # Architectural audit & remediation log
│   ├── FINAL_Q1_REPORT.md             # Comprehensive submission report
│   ├── test-results.json              # Full regression status & coverage
│   ├── websocket-metrics.json         # Packet drop & jitter telemetry
│   ├── synchronization-report.json    # State progression timings
│   ├── race-condition-report.json     # Triple-click timing & idempotency
│   ├── circuit-breaker-report.json    # Backoff retry & coordinate recalculation
│   └── payload-distortion.json        # Intercepted mutated payloads & responses
├── screenshots/                       # Evidence screenshots of key test stages
│   ├── 01-dashboard-synchronized.png
│   ├── 02-websocket-jitter-stream.png
│   ├── 03-triple-click-attack.png
│   ├── 04-payload-distortion-rejection.png
│   └── 05-circuit-breaker-recovery.png
├── src/                               # TradePulse application source
│   ├── dashboard.html                 # Semantic UI terminal
│   ├── dashboard.css                  # Dark-theme trading styles
│   ├── dashboard.js                   # Canvas renderer & state management
│   ├── server.js                      # Express HTTP & WebSocket server
│   └── websocket.js                   # Client socket with exponential reconnect
├── tests/                             # Playwright automated test suites
│   ├── helpers/
│   │   ├── state-guardian.js          # Zero-sleep state synchronization engine
│   │   ├── websocket-interceptor.js   # RouteWebSocket packet drop & jitter buffer
│   │   ├── race-condition.js          # High-resolution 30-120ms click injector
│   │   ├── circuit-breaker.js         # Closed/Open/Half-Open retry mechanism
│   │   └── telemetry.js               # Metrics persistence
│   ├── q1-automation.spec.js          # Master E2E regression specification
│   ├── websocket-fault-injection.spec.js
│   ├── synchronization.spec.js
│   ├── race-condition.spec.js
│   ├── circuit-breaker.spec.js
│   └── payload-distortion.spec.js
├── package.json
└── playwright.config.js
```

### Key Engineering Features
1. **WebSocket Interception (Requirement A):**
   - Intercepts incoming WebSocket frames via Playwright's `page.routeWebSocket()`.
   - Deterministically drops every 4th incoming packet (`packetNumber % 4 === 0`).
   - Introduces ordered network jitter bounded between 2,000 ms and 7,000 ms without blocking the Node event loop.
2. **Dynamic State Guardian (Requirement B):**
   - Eliminates all static sleeps.
   - Monitors state transitions: `IDLE -> LOADING -> RENDERING -> SYNCHRONIZED`.
   - Validates canvas pixel completion and custom `tradepulse:rendered` events.
3. **Triple-Click Race Condition (Requirement C):**
   - Dispatches a 3-click burst within 30–120 ms post-render (measured: 57.1 ms).
   - Verifies backend idempotency (exactly 1 transaction request submitted).
4. **Exponential Backoff Circuit Breaker (Requirement D):**
   - Tri-state machine (`CLOSED`, `OPEN`, `HALF_OPEN`).
   - Recalculates canvas bounding box and target coordinates prior to each retry.
   - Recovers from transient state drift and halts upon permanent failure.
5. **Payload Distortion Attack (Requirement E):**
   - Intercepts outgoing HTTP transaction requests via Playwright network routing.
   - Mutates `precision` to `0x123`, `1e+7`, and non-numeric strings while keeping other fields intact.
   - Verifies server rejection (`HTTP 400`, `PRECISION_VALIDATION_FAILED`) and frontend visual toasts.
   - Verifies clean recovery with subsequent valid transactions.

---

## 4. Acceptance Criteria Verification Matrix

| Requirement | Test Coverage | Status | Evidence File |
|---|---|---|---|
| Server Startup & Health | `q1-automation.spec.js:Q1-E2E-01` | **PASSED** | `evidence/test-results.json` |
| Packet Dropping (Every 4th) | `websocket-fault-injection.spec.js:A1` | **PASSED** | `evidence/websocket-metrics.json` |
| Ordered Jitter (2,000–7,000 ms) | `websocket-fault-injection.spec.js:A2` | **PASSED** | `evidence/websocket-metrics.json` |
| Dynamic State Guardian (Zero-Sleep) | `synchronization.spec.js:B1` | **PASSED** | `evidence/synchronization-report.json` |
| Triple-Click Attack (30–120 ms) | `race-condition.spec.js:C1` | **PASSED** | `evidence/race-condition-report.json` |
| Circuit Breaker Backoff & Recovery | `circuit-breaker.spec.js:D1` | **PASSED** | `evidence/circuit-breaker-report.json` |
| Payload Distortion (`0x123`) | `payload-distortion.spec.js:E1` | **PASSED** | `evidence/payload-distortion.json` |
| Post-Attack Regression | `payload-distortion.spec.js:E3` | **PASSED** | `evidence/test-results.json` |
| Full Suite Regression (17/17) | All 6 Spec Files | **100% PASS** | `playwright-report/index.html` |

---

## 5. Security & Safety Notice

This application is a **simulated trading terminal**. No real cryptocurrency exchange credentials, private keys, or external banking endpoints are accessed. All balances and market movements are localized.
