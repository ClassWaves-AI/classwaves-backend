#!/usr/bin/env node

/**
 * ClassWaves Secret Generation Script
 * Generates cryptographically secure secrets for JWT and session encryption
 * 
 * Usage: node scripts/generate-secrets.js
 */

const crypto = require('crypto');

console.log('🔐 ClassWaves Authentication Secrets Generator');
console.log('=' .repeat(80));

// Generate JWT Refresh Secret (64 bytes = 512 bits)
const jwtRefreshSecret = crypto.randomBytes(64).toString('hex');
console.log('\n📝 JWT_REFRESH_SECRET (copy to your .env file):');
console.log(`JWT_REFRESH_SECRET=${jwtRefreshSecret}`);

// Generate Session Encryption Secret (32 bytes = 256 bits for AES-256)
const sessionEncryptionSecret = crypto.randomBytes(32).toString('hex');
console.log('\n🔒 SESSION_ENCRYPTION_SECRET (copy to your .env file):');
console.log(`SESSION_ENCRYPTION_SECRET=${sessionEncryptionSecret}`);

// Alternative Base64 format (some prefer this)
const jwtRefreshSecretB64 = crypto.randomBytes(64).toString('base64');
const sessionEncryptionSecretB64 = crypto.randomBytes(32).toString('base64');

console.log('\n' + '=' .repeat(80));
console.log('📋 Alternative Base64 Format (if preferred):');
console.log('=' .repeat(80));
console.log(`JWT_REFRESH_SECRET=${jwtRefreshSecretB64}`);
console.log(`SESSION_ENCRYPTION_SECRET=${sessionEncryptionSecretB64}`);

console.log('\n' + '=' .repeat(80));
console.log('🛡️  SECURITY RECOMMENDATIONS:');
console.log('=' .repeat(80));
console.log('✅ Store these secrets securely in your .env file');
console.log('✅ Never commit these secrets to version control');
console.log('✅ Use different secrets for development, staging, and production');
console.log('✅ Rotate these secrets periodically (every 90 days recommended)');
console.log('✅ The JWT refresh secret should be different from your JWT access secret');
console.log('✅ The session encryption secret is exactly 32 bytes (256 bits) for AES-256');

console.log('\n📏 Secret Lengths Generated:');
console.log(`   JWT_REFRESH_SECRET: ${jwtRefreshSecret.length} characters (${jwtRefreshSecret.length * 4} bits)`);
console.log(`   SESSION_ENCRYPTION_SECRET: ${sessionEncryptionSecret.length} characters (${sessionEncryptionSecret.length * 4} bits)`);

console.log('\n🔄 To generate new secrets, run this script again');
console.log('=' .repeat(80));
