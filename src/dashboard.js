
(() => {
    'use strict';

    const $ = (id) => document.getElementById(id);

    // ==========================================
    // 1. DOM ELEMENT REFERENCES
    // ==========================================

    const elements = {
        price: $('livePrice'),
        orderPrice: $('orderPrice'),
        lastUpdate: $('lastUpdate'),
        syncStatus: $('syncStatus'),
        syncDescription: $('syncDescription'),
        chartState: $('chartState'),
        sequence: $('sequenceNumber'),
        skeleton: $('chartSkeleton'),
        chartContainer: $('chartContainer'),
        canvas: $('priceChart'),
        appState: $('appState'),
        connection: $('connectionStatus'),
        transaction: $('transactionResult'),
        notification: $('notification'),
        quantity: $('quantity'),
        precision: $('precision'),
        buy: $('buyButton'),
        sell: $('sellButton')
    };

    // Validate required elements
    for (const [name, element] of Object.entries(elements)) {
        if (!element) {
            throw new Error(`Missing dashboard element: ${name}`);
        }
    }

    const context = elements.canvas.getContext('2d');

    if (!context) {
        throw new Error('Canvas 2D context unavailable');
    }

    // ==========================================
    // 2. MARKET STATE
    // ==========================================

    const market = {
        prices: [],
        sequence: 0,
        synchronized: false,
        lastPrice: 67450,
        previousPrice: 67450,
        firstPaintCompleted: false,
        lastMessageAt: 0
    };

    const MAX_POINTS = 80;

    let notificationTimer = null;
    let socket = null;

    // ==========================================
    // 3. UTILITY FUNCTIONS
    // ==========================================

    function formatPrice(value) {
        return '$' + value.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function setState(state, synchronized) {
        elements.appState.dataset.state = state;
        elements.appState.dataset.stateSync =
            String(synchronized);

        market.synchronized = synchronized;

        console.log('[STATE]', {
            state,
            synchronized
        });
    }

    function notify(message, type = 'success') {
        clearTimeout(notificationTimer);

        elements.notification.textContent = message;

        elements.notification.className =
            `notification visible ${type}`;

        notificationTimer = setTimeout(() => {
            elements.notification.className = 'notification';
        }, 4000);
    }

    // ==========================================
    // 4. WEBSOCKET CONNECTION STATUS
    // ==========================================

    function updateConnection(status) {
        elements.connection.textContent =
            status === 'connected'
                ? 'Connected'
                : 'Disconnected';

        document.querySelectorAll('.connection-dot')
            .forEach(dot => {
                dot.classList.toggle(
                    'connected',
                    status === 'connected'
                );

                dot.classList.toggle(
                    'disconnected',
                    status === 'disconnected'
                );
            });

        if (status === 'disconnected') {
            elements.syncStatus.textContent = 'Offline';

            elements.syncDescription.textContent =
                'Waiting for reconnection';

            setState('disconnected', false);
        }

        if (status === 'connected') {
            elements.syncDescription.textContent =
                'Receiving market data';
            if (!market.firstPaintCompleted) {
                setState('loading', false);
            }
        }
    }

    // ==========================================
    // 5. MARKET DATA PROCESSING
    // ==========================================

    function updatePrice(data) {
        if (
            !data ||
            data.type !== 'MARKET_UPDATE' ||
            typeof data.price !== 'number' ||
            !Number.isFinite(data.price) ||
            data.price <= 0 ||
            typeof data.sequence !== 'number'
        ) {
            console.error('[MARKET] Invalid market data', data);
            return;
        }

        market.previousPrice = market.lastPrice;
        market.lastPrice = data.price;
        market.sequence = data.sequence;
        market.lastMessageAt = performance.now();

        market.prices.push(data.price);

        if (market.prices.length > MAX_POINTS) {
            market.prices.shift();
        }

        // Update live market price
        elements.price.textContent =
            formatPrice(data.price);

        elements.orderPrice.textContent =
            formatPrice(data.price);

        // IMPORTANT:
        // Do not overwrite the precision input here.
        // It must remain editable for payload distortion tests.

        elements.lastUpdate.textContent =
            new Date(data.timestamp).toLocaleTimeString();

        elements.sequence.textContent =
            `Sequence: ${data.sequence}`;

        const change =
            data.price - market.previousPrice;

        const changeElement = $('priceChange');

        changeElement.textContent =
            `${change >= 0 ? '+' : ''}${change.toFixed(2)} since previous tick`;

        changeElement.className =
            change >= 0 ? 'positive' : 'negative';

        // Reveal chart after receiving enough data
        
if (
    market.prices.length >= 5 &&
    !market.firstPaintCompleted
) {
    revealChart();

} else if (market.firstPaintCompleted) {

    setState('updating', false);

    elements.syncStatus.textContent = 'Updating';

    elements.syncDescription.textContent =
        'Rendering incoming market update';

    requestAnimationFrame(() => {

        drawChart();

        requestAnimationFrame(() => {

            setState('synchronized', true);

            elements.syncStatus.textContent =
                'Synchronized';

            elements.syncDescription.textContent =
                'Market data and chart aligned';

            window.__lastTradePulseRenderAt =
                performance.now();

            window.dispatchEvent(
                new CustomEvent('tradepulse:rendered', {
                    detail: {
                        sequence: market.sequence,
                        price: market.lastPrice
                    }
                })
            );

        });

    });
}
    }

    // ==========================================
    // 6. INITIAL CHART RENDERING
    // ==========================================

    function revealChart() {
        setState('rendering', false);

        elements.syncStatus.textContent = 'Rendering';

        elements.syncDescription.textContent =
            'Drawing market chart';

        // Remove loading skeleton
        elements.skeleton.style.display = 'none';

        elements.chartContainer.classList.add('visible');

        requestAnimationFrame(() => {
            drawChart();

            requestAnimationFrame(() => {
                market.firstPaintCompleted = true;
                elements.appState.dataset.rendered = 'true';

                setState('synchronized', true);

                elements.syncStatus.textContent =
                    'Synchronized';

                elements.syncDescription.textContent =
                    'Market data and chart aligned';

                elements.chartState.textContent =
                    'Chart rendering complete';

                // Notify Playwright that rendering is complete
                window.__lastTradePulseRenderAt = performance.now();
                window.dispatchEvent(
                    new CustomEvent('tradepulse:rendered', {
                        detail: {
                            sequence: market.sequence,
                            price: market.lastPrice
                        }
                    })
                );

                console.log(
                    '[STATE] Chart synchronized at sequence',
                    market.sequence
                );
            });
        });
    }

    // ==========================================
    // 7. HTML5 CANVAS CHART
    // ==========================================

    function drawChart() {
        const canvas = elements.canvas;

        const rect = canvas.getBoundingClientRect();

        if (!rect.width || !rect.height) {
            return;
        }

        const ratio = window.devicePixelRatio || 1;

        canvas.width = Math.round(rect.width * ratio);
        canvas.height = Math.round(rect.height * ratio);

        context.setTransform(ratio, 0, 0, ratio, 0, 0);

        const width = rect.width;
        const height = rect.height;

        context.clearRect(0, 0, width, height);

        const values = market.prices;

        if (values.length < 2) {
            return;
        }

        const min = Math.min(...values);
        const max = Math.max(...values);

        const padding = 35;
        const range = Math.max(max - min, 1);

        // Draw grid
        context.strokeStyle = '#263449';
        context.lineWidth = 1;

        for (let i = 0; i < 5; i++) {
            const y = padding +
                (i / 4) * (height - padding * 2);

            context.beginPath();
            context.moveTo(padding, y);
            context.lineTo(width - padding, y);
            context.stroke();
        }

        // Draw price line
        context.beginPath();

        values.forEach((value, index) => {
            const x = padding +
                (index / Math.max(values.length - 1, 1)) *
                (width - padding * 2);

            const y = height - padding -
                ((value - min) / range) *
                (height - padding * 2);

            if (index === 0) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        });

        context.strokeStyle = '#22c55e';
        context.lineWidth = 2.5;
        context.stroke();

        // Current price indicator
        const latestValue = values[values.length - 1];

        const latestY = height - padding -
            ((latestValue - min) / range) *
            (height - padding * 2);

        context.fillStyle = '#22c55e';

        context.beginPath();

        context.arc(
            width - padding,
            latestY,
            5,
            0,
            Math.PI * 2
        );

        context.fill();

        // High and low labels
        context.fillStyle = '#94a3b8';
        context.font = '11px Arial';

        context.fillText(
            `High: ${formatPrice(max)}`,
            padding,
            17
        );

        context.fillText(
            `Low: ${formatPrice(min)}`,
            width - 130,
            17
        );
    }

    // ==========================================
    // 8. TRANSACTION SUBMISSION
    // ==========================================

    let isSubmitting = false;

    async function submitTransaction(action) {
        if (isSubmitting) {
            console.warn('[TRANSACTION] Duplicate submission prevented by in-flight lock');
            return;
        }

        const quantity = Number(elements.quantity.value);
        const precision = elements.precision.value;

        if (
            !Number.isFinite(quantity) ||
            quantity <= 0
        ) {
            notify(
                'Please enter a valid quantity.',
                'error'
            );
            elements.transaction.className = 'transaction-result error';
            elements.transaction.textContent = 'Invalid quantity specified';
            return;
        }

        isSubmitting = true;
        const payload = {
            action,
            symbol: 'BTCUSDT',
            quantity,
            precision
        };

        console.log('[TRANSACTION] Outgoing payload:', payload);

        elements.buy.disabled = true;
        elements.sell.disabled = true;

        elements.transaction.className =
            'transaction-result';

        elements.transaction.textContent =
            'Validating transaction...';

        try {
            const response = await fetch('/api/transaction', {
                method: 'POST',

                headers: {
                    'Content-Type': 'application/json'
                },

                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (!response.ok) {
                const errorMsg = result.error || 'Transaction rejected';
                const codeSuffix = result.code ? ` (${result.code})` : '';
                throw new Error(`${errorMsg}${codeSuffix}`);
            }

            elements.transaction.className =
                'transaction-result success';

            elements.transaction.textContent =
                `Accepted: ${result.transactionId}`;

            notify(
                'Transaction validated successfully.',
                'success'
            );

        } catch (error) {
            elements.transaction.className =
                'transaction-result error';

            elements.transaction.textContent =
                `Transaction rejected: ${error.message}`;

            notify(error.message, 'error');

            console.error(
                '[TRANSACTION ERROR]',
                error
            );

        } finally {
            elements.buy.disabled = false;
            elements.sell.disabled = false;
            isSubmitting = false;
        }
    }

    // ==========================================
    // 9. BUY AND SELL EVENT HANDLERS
    // ==========================================

    elements.buy.addEventListener('click', () => {
        submitTransaction('BUY');
    });

    elements.sell.addEventListener('click', () => {
        submitTransaction('SELL');
    });

    // ==========================================
    // 10. DYNAMIC STATE GUARDIAN
    // ==========================================

    const stateObserver = new MutationObserver(() => {
        const synchronized =
            elements.appState.dataset.stateSync === 'true';

        const state =
            elements.appState.dataset.state;

        if (synchronized) {
            console.log(
                '[GUARDIAN] UI synchronization confirmed',
                state
            );
        }
    });

    stateObserver.observe(elements.appState, {
        attributes: true,

        attributeFilter: [
            'data-state',
            'data-state-sync'
        ]
    });

    // ==========================================
    // 11. RESPONSIVE CANVAS
    // ==========================================

    window.addEventListener('resize', () => {
        if (market.firstPaintCompleted) {
            drawChart();
        }
    });

    // ==========================================
    // 12. WEBSOCKET INITIALIZATION
    // ==========================================

    setState('idle', false);

    socket = new window.TradePulseSocket(
        updatePrice,
        updateConnection
    );

    socket.connect();

    // ==========================================
    // 13. READ-ONLY AUTOMATION DIAGNOSTICS
    // ==========================================

    window.tradePulseDiagnostics = {
        getState: () => ({
            state: elements.appState.dataset.state,
            synchronized: elements.appState.dataset.stateSync === 'true',
            rendered: elements.appState.dataset.rendered === 'true',
            sequence: market.sequence,
            price: market.lastPrice,
            previousPrice: market.previousPrice,
            pointsCount: market.prices.length,
            lastRenderAt: window.__lastTradePulseRenderAt || 0,
            connection: socket?.socket?.readyState === WebSocket.OPEN,
            isSubmitting
        })
    };

    // ==========================================
    // 14. CLEANUP
    // ==========================================

    window.addEventListener('beforeunload', () => {
        if (socket) {
            socket.disconnect();
        }

        stateObserver.disconnect();

        clearTimeout(notificationTimer);
    });

    console.log('[TRADEPULSE] Dashboard initialized');

})();
