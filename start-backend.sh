#!/bin/bash
export NODE_ENV=test
export E2E_TEST_SECRET=test
export JWT_SECRET="test-jwt-secret-for-integration-testing-only-not-for-production-use-minimum-256-bits"
export JWT_REFRESH_SECRET="test-refresh-secret-for-integration-testing-only-not-for-production-use-minimum-256-bits"
npm run dev
