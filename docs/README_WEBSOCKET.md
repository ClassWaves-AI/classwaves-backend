# WebSocket Implementation

## Overview

ClassWaves uses Socket.IO for real-time communication between teachers and students during classroom sessions.

## Features

- **Real-time messaging**: Instant communication within sessions
- **Presence tracking**: See who's online and their status
- **Group management**: Real-time group updates
- **Activity synchronization**: Keep all participants in sync
- **Transcription streaming**: Live transcription updates
- **Scalable architecture**: Redis adapter for multi-server deployment

## Connection

### Client Setup

```javascript
import { io } from 'socket.io-client';

const socket = io('https://api.classwaves.com', {
  auth: {
    token: accessToken // JWT token from authentication
  },
  transports: ['websocket', 'polling']
});
```

### Authentication

WebSocket connections require a valid JWT access token. The token is validated on connection and the session must exist in Redis.

## Events

### Client to Server Events

#### `joinSession(sessionCode: string)`
Join a classroom session.

```javascript
socket.emit('joinSession', 'ABC123');
```

#### `leaveSession(sessionCode: string)`
Leave a classroom session.

```javascript
socket.emit('leaveSession', 'ABC123');
```

#### `sendMessage(data)`
Send a message to all participants in a session.

```javascript
socket.emit('sendMessage', {
  sessionCode: 'ABC123',
  message: 'Hello class!'
});
```

#### `updatePresence(data)`
Update your presence status.

```javascript
socket.emit('updatePresence', {
  sessionCode: 'ABC123',
  status: 'active' // active, idle, away
});
```

### Server to Client Events

#### `sessionJoined`
Confirmation of joining a session with participant list.

```javascript
socket.on('sessionJoined', (data) => {
  console.log(`Joined ${data.sessionCode} with participants:`, data.participants);
});
```

#### `messageReceived`
New message in the session.

```javascript
socket.on('messageReceived', (data) => {
  console.log(`${data.userId}: ${data.message}`);
});
```

#### `presenceUpdated`
Participant presence status changed.

```javascript
socket.on('presenceUpdated', (data) => {
  console.log(`${data.userId} is now ${data.status}`);
});
```

#### `error`
Error occurred during WebSocket operation.

```javascript
socket.on('error', (data) => {
  console.error(`Error ${data.code}: ${data.message}`);
});
```

## Testing

Use the provided test client:
1. Open `examples/websocket-client.html` in a browser
2. Get a JWT token by authenticating via the REST API
3. Enter the token and connect
4. Join a session and start messaging

## Architecture

### Redis Adapter

When Redis is available, Socket.IO uses the Redis adapter for:
- Publishing events across multiple server instances
- Maintaining room state across servers
- Enabling horizontal scaling

### Fallback Mode

If Redis is unavailable, Socket.IO falls back to in-memory adapter:
- Works for single server deployments
- Sessions are lost on server restart
- Not suitable for production

## Security

1. **JWT Authentication**: All connections require valid JWT
2. **Session Validation**: Sessions verified in Redis
3. **Permission Checks**: User access to sessions validated
4. **Rate Limiting**: Connection attempts are rate-limited
5. **Input Validation**: All events validate input data

## Monitoring

Monitor WebSocket health via:
- Connection count metrics
- Message throughput
- Error rates
- Room sizes
- Client disconnect reasons

## Best Practices

1. **Reconnection**: Implement exponential backoff
2. **Error Handling**: Always handle error events
3. **Cleanup**: Leave sessions on disconnect
4. **Heartbeat**: Use Socket.IO's built-in ping/pong
5. **Message Size**: Keep messages under 1MB

## Future Enhancements

- [ ] Binary data support for file sharing
- [ ] Voice/video signaling
- [ ] Persistent message history
- [ ] Typing indicators
- [ ] Read receipts
- [ ] Emoji reactions