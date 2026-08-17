'use strict';

const net = require('net');

const host = '192.168.50.220';

function avr(command, expectedPrefix, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: 23 });
    let buffer = '';
    let settled = false;

    function finish(error, value) {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve(value);
    }

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      socket.write(`${command}\r`);
    });

    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');

      for (const rawLine of buffer.split('\r')) {
        const line = rawLine.trim();

        if (
          line &&
          (
            expectedPrefix !== 'MV'
              ? line.startsWith(expectedPrefix)
              : /^MV\d{2,3}$/.test(line)
          )
        ) {
          finish(null, line);
          return;
        }
      }
    });

    socket.on('timeout', () => {
      finish(new Error(`No response to ${command}`));
    });

    socket.on('error', finish);
  });
}

(async () => {
  try {
    console.log('Power:', await avr('ZM?', 'ZM'));
    console.log('Input:', await avr('SI?', 'SI'));
    console.log('Volume:', await avr('MV?', 'MV'));
    console.log('Mute:', await avr('MU?', 'MU'));
  } catch (error) {
    console.error('AVR error:', error.message);
    process.exitCode = 1;
  }
})();
