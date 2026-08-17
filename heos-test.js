'use strict';

const net = require('net');

const host = '192.168.50.220';
const port = 1255;
const playerId = '48723103';

const socket = net.createConnection({ host, port });

let buffer = '';

socket.setTimeout(3000);

socket.on('connect', () => {
  socket.write(
    `heos://player/get_now_playing_media?pid=${playerId}\r\n`
  );
});

socket.on('data', chunk => {
  buffer += chunk.toString('utf8');

  if (!buffer.includes('\n')) return;

  const line = buffer.split('\n')[0].trim();

  try {
    const response = JSON.parse(line);
    console.log(JSON.stringify(response, null, 2));
  } catch (error) {
    console.error('Invalid HEOS response:', line);
  }

  socket.destroy();
});

socket.on('timeout', () => {
  console.error('HEOS request timed out');
  socket.destroy();
  process.exitCode = 1;
});

socket.on('error', error => {
  console.error('HEOS error:', error.message);
  process.exitCode = 1;
});
