# JWT RS256 Implementation

## Overview

ClassWaves uses RS256 (RSA Signature with SHA-256) for JWT signing, providing enhanced security over HS256.

## Key Generation

Generate RSA key pair for JWT signing:

```bash
# Create keys directory
mkdir -p keys

# Generate 2048-bit RSA private key
openssl genrsa -out keys/private.pem 2048

# Extract public key from private key
openssl rsa -in keys/private.pem -pubout -out keys/public.pem

# Set proper permissions (private key should be readable only by owner)
chmod 600 keys/private.pem
chmod 644 keys/public.pem
```

## Key Storage

- **Development**: Keys are stored in `keys/` directory
- **Production**: Use environment variables or secure key management service

### Environment Variables (Production)

```env
JWT_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
```

## Security Benefits

1. **Asymmetric Cryptography**: Only the private key can sign tokens
2. **Key Rotation**: Can rotate keys without invalidating existing tokens
3. **Microservices**: Services can verify tokens with public key only
4. **Algorithm Confusion**: Prevents HS256/RS256 confusion attacks

## Fallback Behavior

If RSA keys are not found, the system falls back to HS256 with a warning:
- Development: Acceptable for local testing
- Production: Should never happen - ensure keys are properly configured

## Key Rotation Process

1. Generate new key pair
2. Deploy new public key to all services
3. Start signing with new private key
4. Keep old public key for grace period
5. Remove old public key after all tokens expire

## Monitoring

Check logs for:
- "RSA keys not found" warnings
- JWT verification failures
- Key loading errors

## Security Checklist

- [ ] Private key is never exposed in logs
- [ ] Private key has restricted file permissions (600)
- [ ] Keys are backed up securely
- [ ] Key rotation schedule is defined
- [ ] Monitoring alerts for JWT failures