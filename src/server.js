
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 3000;

// Middleware
app.use(express.json({ limit: '10kb' }));
app.use(express.static(__dirname));

// Dashboard entry point
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'TradePulse',
    timestamp: Date.now()
  });
});

// Transaction validation endpoint
app.post('/api/transaction', (req, res) => {
  const { action, symbol, quantity, precision } = req.body;

  if (!['BUY', 'SELL'].includes(action)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid transaction action'
    });
  }

  if (typeof symbol !== 'string' || symbol.length > 20) {
    return res.status(400).json({
      success: false,
      error: 'Invalid trading symbol'
    });
  }

  if (
    typeof quantity !== 'number' ||
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return res.status(400).json({
      success: false,
      error: 'Invalid quantity'
    });
  }

  // Accept only ordinary decimal notation.
  // Reject malformed strings such as hexadecimal values.
  if (
    typeof precision !== 'string' ||
    !/^\d+(\.\d{1,8})?$/.test(precision)
  ) {
    return res.status(400).json({
      success: false,
      error: 'Invalid mathematical precision',
      code: 'PRECISION_VALIDATION_FAILED'
    });
  }

  const transaction = {
    success: true,
    transactionId: `TP-${Date.now()}`,
    action,
    symbol,
    quantity,
    precision,
    timestamp: new Date().toISOString()
  };

  console.log('[TRANSACTION ACCEPTED]', transaction);

  res.status(201).json(transaction);
});

// WebSocket connection
wss.on('connection', (socket) => {
  console.log('[WS] Client connected');

  socket.on('close', () => {
    console.log('[WS] Client disconnected');
  });
});

// Simulated financial market data
let price = 67450.00;
let sequence = 0;

setInterval(() => {
  price += (Math.random() - 0.5) * 25;
  sequence++;

  const marketData = {
    type: 'MARKET_UPDATE',
    symbol: 'BTCUSDT',
    price: Number(price.toFixed(2)),
    sequence,
    timestamp: Date.now()
  };

  const message = JSON.stringify(marketData);

  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}, 250);

// Start server
server.listen(PORT, '127.0.0.1', () => {
  console.log('====================================');
  console.log('       TRADEPULSE SERVER');
  console.log('====================================');
  console.log(`Dashboard: http://127.0.0.1:${PORT}`);
  console.log(`WebSocket: ws://127.0.0.1:${PORT}`);
  console.log(`Health: http://127.0.0.1:${PORT}/api/health`);
  console.log('====================================');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down TradePulse...');
  wss.close();
  server.close(() => process.exit(0));
});
