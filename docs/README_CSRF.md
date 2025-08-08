# CSRF Protection Implementation

## Overview

ClassWaves implements Double Submit Cookie pattern for CSRF protection on all state-changing operations.

## How It Works

1. **Token Generation**: When authenticated users make GET requests, a CSRF token is generated
2. **Token Storage**: Tokens are stored in Redis with 1-hour expiry
3. **Token Validation**: POST/PUT/DELETE requests must include the token
4. **Timing-Safe Comparison**: Prevents timing attacks on token validation

## Frontend Integration

### 1. Fetch CSRF Token

```javascript
// Get CSRF token on app initialization
const response = await fetch('/api/v1/auth/csrf-token', {
  credentials: 'include',
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
const { csrfToken } = await response.json();
```

### 2. Include Token in Requests

```javascript
// Include in headers
fetch('/api/v1/sessions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'X-CSRF-Token': csrfToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(data)
});

// Or in request body
fetch('/api/v1/sessions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    ...data,
    _csrf: csrfToken
  })
});
```

### 3. Read from Cookie

```javascript
// CSRF token is also available as a cookie
function getCSRFToken() {
  const match = document.cookie.match(/csrf-token=([^;]+)/);
  return match ? match[1] : null;
}
```

## Protected Routes

All routes are protected except:
- GET, HEAD, OPTIONS requests (safe methods)
- `/api/v1/health` - Health check
- `/.well-known/*` - JWKS endpoints
- `/api/v1/auth/google` - OAuth callbacks

## Error Handling

### Missing Token
```json
{
  "error": "CSRF_TOKEN_MISSING",
  "message": "CSRF token is required for this request"
}
```

### Invalid Token
```json
{
  "error": "CSRF_TOKEN_INVALID",
  "message": "Invalid CSRF token"
}
```

## Security Considerations

1. **Token Rotation**: New token generated for each session
2. **Secure Storage**: Tokens stored in Redis, not in JWT
3. **HttpOnly Cookies**: Session cookies are HttpOnly
4. **SameSite Strict**: Prevents CSRF via third-party sites
5. **Timing Safe**: Constant-time comparison prevents timing attacks

## Testing CSRF Protection

```bash
# Without CSRF token (should fail)
curl -X POST http://localhost:3001/api/v1/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Session"}'

# With CSRF token (should succeed)
curl -X POST http://localhost:3001/api/v1/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Session"}'
```

## Configuration

- **Token Length**: 32 bytes (64 hex characters)
- **Token Expiry**: 1 hour
- **Header Name**: `X-CSRF-Token`
- **Cookie Name**: `csrf-token`
- **Body Field**: `_csrf` (fallback)