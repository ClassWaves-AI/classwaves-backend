/**
 * Integration tests for PKCE validation in auth controller
 */

import request from 'supertest';
import app from '../../app';

describe('Auth Controller PKCE Integration', () => {
  describe('POST /api/v1/auth/google - PKCE validation', () => {
    test('accepts valid code flow with PKCE verifier', async () => {
      const response = await request(app)
        .post('/api/v1/auth/google')
        .send({
          code: 'valid_test_code',
          codeVerifier: 'valid_pkce_verifier_abcdefghijklmnopqrstuvwxyz123456789',
          state: 'test_state'
        });

      // Note: This will likely fail with actual Google validation in test
      // but should not fail due to PKCE validation itself
      expect(response.status).not.toBe(400);
      if (response.status === 400) {
        expect(response.body.error).not.toBe('PKCE_VERIFIER_MISSING_OR_INVALID');
      }
    });

    test('rejects code flow without PKCE verifier', async () => {
      const response = await request(app)
        .post('/api/v1/auth/google')
        .send({
          code: 'test_code_without_verifier',
          state: 'test_state'
          // Missing codeVerifier
        });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: 'PKCE_VERIFIER_MISSING_OR_INVALID',
        message: 'Missing or invalid PKCE verifier',
        statusCode: 400
      });
    });

    test('rejects code flow with invalid PKCE verifier (too short)', async () => {
      const response = await request(app)
        .post('/api/v1/auth/google')
        .send({
          code: 'test_code',
          codeVerifier: 'too_short', // Less than 43 characters
          state: 'test_state'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    });

    test('rejects code flow with invalid PKCE verifier (too long)', async () => {
      const response = await request(app)
        .post('/api/v1/auth/google')
        .send({
          code: 'test_code',
          codeVerifier: 'a'.repeat(300), // More than 256 characters
          state: 'test_state'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    });

    test('allows credential flow without PKCE verifier (GSI compatibility)', async () => {
      const response = await request(app)
        .post('/api/v1/auth/google')
        .send({
          credential: 'valid_gsi_credential_token'
          // No code, no codeVerifier - should be fine for GSI flow
        });

      // Should not fail due to missing PKCE verifier for credential flow
      expect(response.status).not.toBe(400);
      if (response.status === 400) {
        expect(response.body.error).not.toBe('PKCE_VERIFIER_MISSING_OR_INVALID');
      }
    });

    test('validates request structure with both code and credential', async () => {
      const response = await request(app)
        .post('/api/v1/auth/google')
        .send({
          code: 'test_code',
          credential: 'test_credential',
          codeVerifier: 'valid_pkce_verifier_abcdefghijklmnopqrstuvwxyz123456789'
        });

      // Should accept the request structure (though may fail for other reasons)
      expect(response.status).not.toBe(400);
      if (response.status === 400) {
        expect(response.body.error).not.toBe('PKCE_VERIFIER_MISSING_OR_INVALID');
      }
    });
  });

  describe('Validation schema compliance', () => {
    test('PKCE verifier validation matches RFC 7636', async () => {
      // Test minimum length (43 chars)
      const minResponse = await request(app)
        .post('/api/v1/auth/google')
        .send({
          code: 'test',
          codeVerifier: 'a'.repeat(43) // Minimum valid length
        });

      expect(minResponse.status).not.toBe(400);
      if (minResponse.status === 400) {
        expect(minResponse.body.error).not.toContain('codeVerifier');
      }

      // Test maximum length (256 chars)
      const maxResponse = await request(app)
        .post('/api/v1/auth/google')
        .send({
          code: 'test',
          codeVerifier: 'a'.repeat(256) // Maximum valid length
        });

      expect(maxResponse.status).not.toBe(400);
      if (maxResponse.status === 400) {
        expect(maxResponse.body.error).not.toContain('codeVerifier');
      }
    });

    test('handles edge cases gracefully', async () => {
      // Empty codeVerifier
      const emptyResponse = await request(app)
        .post('/api/v1/auth/google')
        .send({
          code: 'test',
          codeVerifier: ''
        });

      expect(emptyResponse.status).toBe(400);

      // Null codeVerifier
      const nullResponse = await request(app)
        .post('/api/v1/auth/google')
        .send({
          code: 'test',
          codeVerifier: null
        });

      expect(nullResponse.status).toBe(400);
    });
  });
});
