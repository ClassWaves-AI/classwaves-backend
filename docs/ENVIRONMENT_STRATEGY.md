# ClassWaves Environment Strategy 

**Document Type:** Technical Architecture & Testing Strategy  
**Created:** Phase 1 Stabilization - Task 1.4 [P3]  
**Status:** **DEFINITIVE** - Formal environment strategy for all testing levels  
**Scope:** Integration, E2E, and Production testing environments  

---

## 🎯 **Executive Summary**

This document defines ClassWaves' comprehensive environment strategy for testing and production validation. The approach balances development velocity, cost efficiency, and production safety through a three-tier environment model with clear data segregation and transition planning.

**Key Principles:**
- **Development Velocity**: Enable rapid testing without complex infrastructure
- **Cost Efficiency**: Minimize infrastructure overhead while maintaining test fidelity  
- **Production Safety**: Ensure thorough validation before production deployments
- **Data Segregation**: Clear boundaries between test and production data

---

## 🏗️ **Environment Tier Definitions**

### **Tier 1: Unit & Integration Tests**
**Status:** ✅ **ACTIVE - Temporary Production Sandbox Approach**

```bash
# Database Strategy
Database: Databricks Production Workspace
Schema: classwaves (shared with production)
Data Strategy: Test data with prefixed identifiers (e.g., "integration_test_", "e2e-session-")
Cleanup: Automatic cleanup after test completion using test data tracking

# Redis Strategy  
Redis: Local Redis instance (redis://localhost:6379)
Namespace: Test-prefixed keys (e.g., "test:session:", "integration:")
TTL: Short TTLs (5-30 minutes) for automatic cleanup

# Authentication
Mode: Test tokens generated via /api/v1/auth/generate-test-token
Credentials: E2E_TEST_SECRET=test for token generation
Permissions: Full API access for test scenarios

# Environment Variables
NODE_ENV=test
E2E_TEST_SECRET=test  
DATABRICKS_TOKEN=[production-token-with-read-write-access]
REDIS_URL=redis://localhost:6379
```

**Rationale:** Uses production Databricks workspace with careful test data management to avoid infrastructure duplication while ensuring realistic testing conditions.

**Data Management:**
- **Test Data Prefixes**: All test data uses identifiable prefixes (`integration_test_`, `e2e-session-`, `teacher_test_`)
- **Automatic Cleanup**: Test suites track created resources and clean them up in `afterAll` hooks
- **Time-based Isolation**: Test IDs include timestamps to prevent collision between parallel test runs
- **Schema Sharing**: Uses production schema but with clear test data boundaries

---

### **Tier 2: End-to-End (E2E) Tests**
**Status:** ✅ **ACTIVE - Frontend + Backend Integration**

```bash
# Backend Server
Server: Local backend server (localhost:3000)
Mode: NODE_ENV=test E2E_TEST_SECRET=test npm run dev
Database: Same as Tier 1 (Production workspace + test data)
Redis: Local Redis with staging-like namespace (e2e:*)

# Frontend Server  
Server: Local dev server (localhost:3001)
Mode: npm run dev (development mode)
API Target: http://localhost:3000

# Test Execution
Framework: Playwright  
Browser: Chrome, Firefox, Safari (authenticated + unauthenticated projects)
Test Data: Shared with Tier 1, additional E2E-specific prefixes

# Authentication Flow
1. Backend generates test teacher tokens via /api/auth/test-login
2. Frontend uses tokens for authenticated test scenarios  
3. Unauthenticated tests run without tokens
4. WebSocket tests use real WebSocket connections
```

**Key Features:**
- **Full-Stack Integration**: Real frontend ↔ backend ↔ database communication
- **WebSocket Testing**: Real-time features validated with live WebSocket connections  
- **Multi-Browser Support**: Chrome, Firefox, Safari compatibility validation
- **Authentication Testing**: Both authenticated and unauthenticated user journeys

---

### **Tier 3: Production Smoke Tests**  
**Status:** 🟡 **PLANNED - Post-Deployment Validation**

```bash
# Database Strategy
Database: Databricks Production Workspace  
Schema: classwaves (production schema)
Access: READ-ONLY - No write operations allowed
Validation: Health checks, data integrity, performance metrics

# Redis Strategy
Redis: Production Redis instance
Access: READ-ONLY - Connection and performance validation only
Validation: Connection health, hit rates, memory usage

# Test Scope
Health Endpoints: /api/v1/health/* (all health check endpoints)
Authentication: OAuth flow validation (non-destructive)
Database: Connection validation + query performance sampling
WebSocket: Connection establishment (no persistent connections)
Analytics: Read-only dashboard data validation
```

**Safety Guarantees:**
- **Read-Only Operations**: No data creation, modification, or deletion
- **Non-Destructive Testing**: No impact on production data or user sessions
- **Limited Scope**: Focus on system health and connectivity validation  
- **Monitoring Integration**: Results feed into alerting systems

---

## 🔄 **Transition Plan: Moving to Dedicated Staging**

### **Current State (Temporary)**
```
Development → Integration Tests (Prod DB + Test Data) → E2E Tests (Prod DB + Test Data) → Production
```

### **Future State (Target Architecture)**
```  
Development → Integration Tests (Staging DB) → E2E Tests (Staging DB) → Smoke Tests (Prod - Read Only) → Production
```

### **Migration Steps**

#### **Phase A: Databricks Staging Workspace Provisioning**
**Timeline:** Q1 2025 (Post Phase 1-6 Stabilization)

1. **Provision Databricks Staging Workspace**
   - Create dedicated staging workspace  
   - Mirror production Unity Catalog structure
   - Set up automated schema synchronization from production

2. **Configure Staging Data Pipeline**
   - Production data replication (sanitized/anonymized)
   - Test data seeding workflows
   - Automated cleanup and refresh cycles

#### **Phase B: Test Migration** 
**Timeline:** Q2 2025

1. **Update Integration Tests**
   ```bash
   # New Integration Environment
   DATABRICKS_HOST=staging-workspace.cloud.databricks.com
   DATABRICKS_TOKEN=staging-specific-token
   DATABRICKS_CATALOG=classwaves_staging
   ```

2. **Update E2E Tests**
   - Point to staging workspace
   - Maintain same test data management patterns
   - Update CI/CD pipelines

3. **Implement Production Smoke Tests**
   - Read-only health validation
   - Post-deployment verification
   - Automated rollback triggers

#### **Phase C: Production Safety Enhancement**
**Timeline:** Q3 2025

1. **Enhanced Monitoring**
   - Staging environment health dashboards
   - Test data lifecycle tracking
   - Performance comparison (staging vs production)

2. **Automated Quality Gates** 
   - Integration test success → E2E test trigger
   - E2E test success → Staging deployment approval
   - Smoke test success → Production deployment approval

---

## 📋 **Implementation Guidelines**

### **For Developers**

#### **Running Integration Tests**
```bash
# Backend integration tests
cd classwaves-backend
NODE_ENV=test npm run test:integration

# Specific test with real database
NODE_ENV=test DATABRICKS_TOKEN=<token> npm run test src/__tests__/integration/analytics-computation-real-db.integration.test.ts
```

#### **Running E2E Tests**  
```bash
# Start backend in test mode
cd classwaves-backend  
NODE_ENV=test E2E_TEST_SECRET=test npm run dev

# Start frontend (separate terminal)
cd classwaves-frontend
npm run dev

# Run E2E tests (separate terminal)
cd classwaves-frontend
E2E_TEST_SECRET=test npm run e2e
```

### **For CI/CD Pipelines**

#### **Integration Test Stage**
- Requires: Databricks token, local Redis
- Environment: `NODE_ENV=test`
- Data: Automatic test data creation and cleanup
- Duration: 5-15 minutes

#### **E2E Test Stage**
- Requires: Backend + Frontend servers, Databricks token
- Environment: Full localhost testing environment
- Browsers: Chrome (headless), Firefox, Safari  
- Duration: 10-30 minutes

#### **Smoke Test Stage**
- Requires: Production access credentials (read-only)
- Environment: Production systems
- Operations: Health checks only, no data modifications
- Duration: 2-5 minutes

---

## 🔍 **Environment Validation Checklist**

### **Pre-Test Environment Health**
- [ ] Databricks connection established
- [ ] Redis connection verified
- [ ] Required environment variables set
- [ ] Test data cleanup from previous runs
- [ ] Authentication services operational

### **Post-Test Environment Cleanup**
- [ ] Test sessions removed from database
- [ ] Test groups and members cleaned up
- [ ] Redis test keys expired or deleted
- [ ] Test teacher accounts cleaned up
- [ ] No test data in production-used tables

### **Environment Performance Baselines** 
- [ ] Database query latency < 100ms P95
- [ ] Redis hit rate > 70% 
- [ ] API response times < 500ms P95
- [ ] WebSocket connection establishment < 2s
- [ ] Test data cleanup completion < 30s

---

## 🚨 **Security & Compliance Notes**

### **Data Segregation**
- **Test Data Identification**: All test data uses prefixed naming conventions
- **Automatic Cleanup**: No test data persists beyond test completion
- **Production Isolation**: Clear boundaries prevent test data from affecting production queries

### **Access Control**
- **Integration Tests**: Use production credentials but with test data only
- **E2E Tests**: Isolated test tokens with appropriate scoping
- **Smoke Tests**: Read-only credentials with minimal required permissions

### **Compliance Considerations**
- **FERPA Compliance**: Test data uses anonymized/synthetic identifiers
- **COPPA Compliance**: No real student data used in testing environments
- **Data Retention**: Test data immediately deleted after test completion
- **Audit Logging**: All test activities logged for compliance validation

---

## 🎯 **Success Metrics**

### **Environment Reliability**
- Integration Test Pass Rate: >95%
- E2E Test Pass Rate: >90%
- Environment Setup Time: <2 minutes
- Test Data Cleanup Success: 100%

### **Performance Targets** 
- Integration Test Suite: <15 minutes
- E2E Test Suite: <30 minutes
- Smoke Test Suite: <5 minutes
- Environment Teardown: <2 minutes

### **Production Safety**
- Zero test data in production queries
- Zero production data modifications from tests  
- Zero test-induced production outages
- 100% test environment isolation

---

## 📞 **Support & Escalation**

### **Environment Issues**
- **Database Connection Failures**: Check Databricks token expiration and workspace status
- **Redis Connection Issues**: Verify local Redis service and port availability
- **Test Data Conflicts**: Review test prefixing and cleanup procedures
- **Performance Degradation**: Run performance baseline tool to identify bottlenecks

### **Emergency Procedures**  
- **Test Data in Production**: Execute immediate cleanup queries with test prefixes
- **Environment Contamination**: Reset test environment and re-run validation checklist
- **CI/CD Pipeline Failures**: Check environment health before investigating test failures

---

**Document Status:** ✅ **APPROVED** for Phase 1 Stabilization completion  
**Next Review:** Post Phase 6 completion or Databricks Staging workspace availability  
**Owner:** ClassWaves Engineering Team  
**Approvers:** Technical Architecture, QA, DevOps
