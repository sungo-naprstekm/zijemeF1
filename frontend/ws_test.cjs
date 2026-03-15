const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8081');
let count = 0;
let gotPos = false;

ws.on('message', (data) => {
    count++;
    try {
        const msg = JSON.parse(data);
        if (msg.category === 'Position') {
            if (!gotPos) {
                console.log('FIRST POSITION:', JSON.stringify(msg.data).substring(0, 150));
                gotPos = true;
            }
        }
    } catch(e) {}
});

ws.on('open', () => {
    console.log('connected, waiting 10s for messages');
    setTimeout(() => {
        ws.close();
        console.log('done, total messages:', count);
    }, 10000);
});
