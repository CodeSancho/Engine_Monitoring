/**
 * websocket/liveStream.js
 * Handles Socket.io connections and room management.
 */

function setupWebSocket(io) {
  io.on('connection', socket => {
    console.log(`[WS] Client connected: ${socket.id}`);

    socket.on('subscribe_truck', truckId => {
      socket.join(`truck_${truckId}`);
      console.log(`[WS] ${socket.id} subscribed to ${truckId}`);
    });

    socket.on('unsubscribe_truck', truckId => {
      socket.leave(`truck_${truckId}`);
    });

    socket.on('disconnect', () => {
      console.log(`[WS] Client disconnected: ${socket.id}`);
    });
  });

  console.log('[WS] WebSocket handler ready');
}

module.exports = { setupWebSocket };
