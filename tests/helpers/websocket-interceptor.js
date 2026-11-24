/**
 * WebSocket Fault-Injection Interceptor
 * Playwright RouteWebSocket Implementation for TradePulse Q1
 * Supports deterministic packet dropping, ordered network jitter, and telemetry.
 */

const { saveEvidence } = require('./telemetry');

class WebSocketInterceptor {
  constructor(options = {}) {
    this.dropInterval = options.dropInterval !== undefined ? options.dropInterval : 4;
    this.enableDropping = options.enableDropping !== undefined ? options.enableDropping : true;
    this.enableJitter = options.enableJitter !== undefined ? options.enableJitter : true;
    this.minJitterMs = options.minJitterMs !== undefined ? options.minJitterMs : 2000;
    this.maxJitterMs = options.maxJitterMs !== undefined ? options.maxJitterMs : 7000;

    // Deterministic jitter schedule (bounded between minJitterMs and maxJitterMs)
    this.jitterSchedule = options.jitterSchedule || [
      2150, 3400, 5200, 2800, 6100, 4300, 3100, 4900, 6750, 2500,
      3800, 5900, 2200, 4600, 6300, 2900, 5100, 3700, 6900, 2400
    ];
    this.jitterIndex = 0;

    // Instrumentation telemetry
    this.metrics = {
      packetsReceived: 0,
      packetsDropped: 0,
      packetsForwarded: 0,
      droppedSequences: [],
      forwardedSequences: [],
      sequenceGaps: [],
      jitterApplied: [],
      averageLatency: 0,
      maximumLatency: 0,
      connectionState: 'INITIALIZING',
      startTime: 0,
      endTime: 0
    };

    // Queue for message ordering during jitter
    this.deliveryQueue = [];
    this.queueTimer = null;
    this.lastScheduledTime = 0;
    this.clientSocket = null;
    this.serverSocket = null;
    this.activeTimeouts = new Set();
  }

  getNextJitter() {
    if (!this.enableJitter) {
      return 0;
    }
    const val = this.jitterSchedule[this.jitterIndex % this.jitterSchedule.length];
    this.jitterIndex++;
    // Clamp to configured bounds
    return Math.max(this.minJitterMs, Math.min(this.maxJitterMs, val));
  }

  async attach(page, urlPattern = /.*:3000.*/) {
    this.metrics.connectionState = 'ARMED';
    this.metrics.startTime = Date.now();

    await page.routeWebSocket(urlPattern, (ws) => {
      this.clientSocket = ws;
      this.metrics.connectionState = 'INTERCEPTING';
      const server = ws.connectToServer();
      this.serverSocket = server;

      // Forward client-to-server messages transparently
      ws.onMessage((message) => {
        try {
          server.send(message);
        } catch (err) {
          console.error('[WS-INTERCEPTOR] Error forwarding client message:', err);
        }
      });

      // Intercept server-to-client frames
      server.onMessage((message) => {
        this.handleIncomingServerFrame(message, ws);
      });

      ws.onClose(() => {
        this.metrics.connectionState = 'CLOSED';
        this.cleanupTimers();
        try {
          server.close();
        } catch (_) {}
      });

      server.onClose(() => {
        this.metrics.connectionState = 'SERVER_CLOSED';
        this.cleanupTimers();
        try {
          ws.close();
        } catch (_) {}
      });
    });

    console.log('[WS-INTERCEPTOR] WebSocket interception armed on pattern:', urlPattern);
  }

  handleIncomingServerFrame(rawMessage, clientWs) {
    this.metrics.packetsReceived++;
    const packetNum = this.metrics.packetsReceived;

    let parsed = null;
    try {
      if (typeof rawMessage === 'string') {
        parsed = JSON.parse(rawMessage);
      } else if (Buffer.isBuffer(rawMessage)) {
        parsed = JSON.parse(rawMessage.toString('utf8'));
      }
    } catch (_) {
      // Non-JSON frame, forward directly
      clientWs.send(rawMessage);
      return;
    }

    if (!parsed || parsed.type !== 'MARKET_UPDATE') {
      clientWs.send(rawMessage);
      return;
    }

    const sequence = parsed.sequence;

    // Requirement A: Drop every fourth incoming MARKET_UPDATE packet
    const shouldDrop = this.enableDropping && (packetNum % this.dropInterval === 0);

    if (shouldDrop) {
      this.metrics.packetsDropped++;
      this.metrics.droppedSequences.push(sequence);
      console.log(`[WS-INTERCEPTOR] DROPPED packet #${packetNum} (sequence: ${sequence})`);
      return;
    }

    // Forwarding logic with deterministic network jitter and preserved ordering
    const jitterMs = this.getNextJitter();
    this.metrics.jitterApplied.push(jitterMs);

    // Track sequence gaps
    if (this.metrics.forwardedSequences.length > 0) {
      const lastSeq = this.metrics.forwardedSequences[this.metrics.forwardedSequences.length - 1];
      if (sequence - lastSeq > 1) {
        this.metrics.sequenceGaps.push({
          fromSequence: lastSeq,
          toSequence: sequence,
          missingCount: sequence - lastSeq - 1
        });
      }
    }

    if (jitterMs <= 0) {
      // Direct forwarding without jitter
      this.metrics.packetsForwarded++;
      this.metrics.forwardedSequences.push(sequence);
      clientWs.send(rawMessage);
      return;
    }

    // Enqueue for ordered jitter delivery
    const now = Date.now();
    const scheduledTime = Math.max(now + jitterMs, this.lastScheduledTime + 50);
    this.lastScheduledTime = scheduledTime;
    const delay = scheduledTime - now;

    const timeoutId = setTimeout(() => {
      this.activeTimeouts.delete(timeoutId);
      try {
        clientWs.send(rawMessage);
        this.metrics.packetsForwarded++;
        this.metrics.forwardedSequences.push(sequence);
      } catch (err) {
        console.error(`[WS-INTERCEPTOR] Failed to send delayed packet #${packetNum}:`, err.message);
      }
    }, delay);

    this.activeTimeouts.add(timeoutId);
  }

  cleanupTimers() {
    for (const t of this.activeTimeouts) {
      clearTimeout(t);
    }
    this.activeTimeouts.clear();
  }

  getMetrics() {
    this.metrics.endTime = Date.now();
    const jitter = this.metrics.jitterApplied;
    if (jitter.length > 0) {
      const sum = jitter.reduce((a, b) => a + b, 0);
      this.metrics.averageLatency = Math.round(sum / jitter.length);
      this.metrics.maximumLatency = Math.max(...jitter);
    } else {
      this.metrics.averageLatency = 0;
      this.metrics.maximumLatency = 0;
    }
    return { ...this.metrics };
  }

  saveMetrics(filename = 'websocket-metrics.json') {
    const finalMetrics = this.getMetrics();
    return saveEvidence(filename, finalMetrics);
  }
}

module.exports = {
  WebSocketInterceptor
};
