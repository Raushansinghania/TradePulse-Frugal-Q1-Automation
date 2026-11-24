
(() => {
    class TradePulseSocket {
        constructor(onMessage, onStatus) {
            this.onMessage = onMessage;
            this.onStatus = onStatus;
            this.socket = null;
            this.reconnectDelay = 1000;
            this.maxReconnectDelay = 10000;
            this.stopped = false;
        }

        connect() {
            if (this.stopped) return;

            this.socket = new WebSocket('ws://127.0.0.1:3000');

            this.socket.addEventListener('open', () => {
                this.reconnectDelay = 1000;
                this.onStatus('connected');
                console.log('[WS] Connected to TradePulse');
            });

            this.socket.addEventListener('message', (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'MARKET_UPDATE') {
                        this.onMessage(data);
                    }
                } catch (error) {
                    console.error('[WS] Invalid message:', error);
                }
            });

            this.socket.addEventListener('error', (error) => {
                console.error('[WS] Connection error:', error);
            });

            this.socket.addEventListener('close', () => {
                this.onStatus('disconnected');

                if (!this.stopped) {
                    const delay = this.reconnectDelay;

                    console.warn(
                        `[WS] Reconnecting in ${delay}ms`
                    );

                    this.reconnectDelay = Math.min(
                        this.reconnectDelay * 2,
                        this.maxReconnectDelay
                    );

                    setTimeout(() => this.connect(), delay);
                }
            });
        }

        disconnect() {
            this.stopped = true;

            if (this.socket) {
                this.socket.close();
            }
        }
    }

    window.TradePulseSocket = TradePulseSocket;
})();
