# WebSocket Namespace Migration Strategy (Pre-MVP)

## 🎯 Overview

Migrate from single WebSocket connection causing conflicts to namespace-based architecture with separate connections for sessions and teacher guidance. Since we're pre-MVP, we'll do a direct cutover without feature flags.

## 📋 Migration Phases

### Phase 1: Backend Infrastructure ✅
- [x] Created namespace base service
- [x] Implemented sessions namespace service
- [x] Implemented guidance namespace service
- [x] Created namespaced WebSocket service
- [x] Updated server initialization

### Phase 2: Frontend Services ✅  
- [x] Created sessions WebSocket service
- [x] Created guidance WebSocket service
- [x] Created namespace-specific hooks
- [x] Exported unified interface

### Phase 3: Component Migration (Current)
- [ ] Update session detail page
- [ ] Update teacher guidance integration
- [ ] Update student session components
- [ ] Test namespace connections

### Phase 4: Testing & Validation
- [ ] Unit tests for namespace services
- [ ] Integration tests for connection management
- [ ] E2E tests for session workflows
- [ ] Basic load testing

### Phase 5: Direct Deployment (Pre-MVP)
- [ ] Direct cutover deployment
- [ ] Monitoring and observability
- [ ] Rollback plan

## 🔄 Simplified Rollback Strategy (Pre-MVP)

### Immediate Rollback (< 5 minutes)
1. **Git Revert**:
   ```bash
   git revert <namespace-migration-commit>
   git push origin main
   ```

2. **Service Restart**: 
   ```bash
   # Backend
   cd classwaves-backend && npm run dev
   
   # Frontend
   cd classwaves-frontend && npm run dev
   ```

## 🧪 Testing Strategy

### Unit Tests
```typescript
// Backend namespace services
describe('SessionsNamespaceService', () => {
  test('handles session join correctly')
  test('manages multiple connections per user')
  test('broadcasts group status changes')
})

describe('GuidanceNamespaceService', () => {
  test('filters teacher-only access')
  test('handles prompt interactions')
  test('manages subscription state')
})
```

### Integration Tests
```typescript
// Frontend-backend namespace communication
describe('Namespace Integration', () => {
  test('sessions and guidance connect independently')
  test('reconnection works for both namespaces')
  test('data isolation between namespaces')
})
```

### E2E Tests
```typescript
// Complete user workflows
describe('Session Management', () => {
  test('teacher creates and manages session')
  test('students join groups without conflicts')
  test('real-time updates work reliably')
})
```

## 📊 Monitoring & Observability

### Key Metrics
- **Connection Counts**: Per namespace user counts
- **Reconnection Rates**: Failed connections and recovery
- **Event Throughput**: Messages per second per namespace
- **Error Rates**: Connection failures and timeouts

### Health Endpoint
```typescript
// WebSocket health endpoint
GET /api/health/websocket
{
  "status": "healthy",
  "namespaces": {
    "sessions": { "users": 5, "sockets": 6 },
    "guidance": { "users": 2, "sockets": 2 }
  },
  "redis": { "connected": true },
  "uptime": 86400
}
```

## 🚀 Pre-MVP Deployment

### Development Environment
```bash
# 1. Backend
cd classwaves-backend
npm install
npm run dev

# 2. Frontend  
cd classwaves-frontend
npm install
npm run dev

# 3. Test connections
curl http://localhost:3000/health/websocket
```

### Simple Production Deployment
```bash
# 1. Deploy backend
cd classwaves-backend
git pull origin main
npm ci
npm run build
pm2 restart classwaves-backend

# 2. Deploy frontend
cd classwaves-frontend
git pull origin main
npm ci
npm run build
# Deploy to your hosting service

# 3. Verify
curl https://your-api-domain.com/health/websocket
```

## 🎉 Success Criteria (Pre-MVP)

### Technical
- **Zero connection conflicts**: No rapid connect/disconnect loops
- **Both namespaces working**: Sessions + guidance connections independent
- **Basic functionality**: Session management and teacher guidance operational
- **No crashes**: Application stable under normal load

### Business
- **Demo ready**: All core features work for demos
- **Teacher workflow**: Can create sessions and receive guidance
- **Student experience**: Can join sessions and participate
- **Development efficiency**: Team can iterate on features reliably

## 📝 Simple Migration Execution

### Step 1: Test Locally
```bash
# Start both services with namespaces
npm run dev:backend
npm run dev:frontend

# Verify no connection conflicts in logs
tail -f logs/backend.log | grep -E "(connected|disconnected)"
```

### Step 2: Deploy to Staging/Production
```bash
# Deploy backend changes
git push origin main
# Deploy frontend changes  
# (follow your deployment process)

# Monitor for conflicts
curl -s https://api.classwaves.com/health/websocket | jq .
```

### Step 3: Validate
- [ ] Session creation works
- [ ] Teacher guidance appears
- [ ] No WebSocket conflicts in logs
- [ ] Real-time features functional

## 🚨 Emergency Procedures (Simplified)

### If Connection Issues Occur
```bash
# 1. Quick restart
pm2 restart classwaves-backend

# 2. If still issues, revert to main
git checkout main
npm run build
pm2 restart classwaves-backend
```

### If Frontend Issues
```bash
# Revert frontend deploy
# (restore previous build or redeploy from main branch)
```

## ✅ Completion Checklist

- [ ] Backend namespaces deployed
- [ ] Frontend hooks updated
- [ ] Session detail page using namespaced connections
- [ ] Teacher guidance using namespaced connections
- [ ] No connection conflicts in logs
- [ ] All real-time features working
- [ ] Team can demo core functionality

This simplified approach removes all the feature flag complexity since you're pre-MVP and can do direct cutovers without worrying about production user impact.
