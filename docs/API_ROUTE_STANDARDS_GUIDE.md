# API Route Standards Guide

**Document Version**: 1.0  
**Created**: December 2024  
**Last Updated**: December 2024  

## 📋 Overview

This guide establishes standardized route patterns for the ClassWaves API to ensure consistency, maintainability, and developer experience across all endpoints. These standards were established after the successful Route Standardization Implementation (December 2024).

---

## 🎯 Design Principles

### 1. **RESTful Consistency** 
Follow REST conventions for resource naming and HTTP methods.

### 2. **Frontend-First Design**
Routes should match frontend developer expectations and minimize API client complexity.

### 3. **Logical Hierarchy**
Group related endpoints under common prefixes for intuitive navigation.

### 4. **Backward Compatibility**
Always maintain existing routes when introducing new patterns.

### 5. **Zero Breaking Changes**
New route patterns should never break existing integrations.

---

## 📐 Standardized Route Patterns

### Base URL Structure
```
https://api.classwaves.com/api/v1/{resource}/{action}
```

### Route Categories

#### **Authentication & User Management**
```
POST   /api/v1/auth/google                    # OAuth initiation
GET    /api/v1/auth/google/callback           # OAuth callback
POST   /api/v1/auth/refresh                   # Token refresh
POST   /api/v1/auth/logout                    # User logout
GET    /api/v1/users/profile                  # Current user profile
PUT    /api/v1/users/profile                  # Update profile
```

#### **Session Management**
```
GET    /api/v1/sessions                       # List sessions
POST   /api/v1/sessions                       # Create session
GET    /api/v1/sessions/{id}                  # Get session details
PUT    /api/v1/sessions/{id}                  # Update session
DELETE /api/v1/sessions/{id}                  # Delete session
POST   /api/v1/sessions/{id}/start            # Start session
POST   /api/v1/sessions/{id}/end              # End session
```

#### **AI Analysis System** ✅ **STANDARDIZED**
```
# Primary Analysis Endpoints (Frontend-Compatible)
POST   /api/v1/ai/analyze-discussion          # Tier 1 analysis
POST   /api/v1/ai/generate-insights           # Tier 2 analysis
GET    /api/v1/ai/insights/{sessionId}        # Retrieve insights

# System Status
GET    /api/v1/ai/status                      # Overall system status
GET    /api/v1/ai/status/tier1                # Tier 1 status
GET    /api/v1/ai/status/tier2                # Tier 2 status

# Teacher Guidance (Future Implementation)
POST   /api/v1/ai/prompts/{sessionId}         # Generate prompts
GET    /api/v1/ai/prompts/{sessionId}         # Retrieve prompts
```

#### **Analytics & Reporting**
```
# Teacher-Level Analytics
GET    /api/v1/analytics/teacher              # Current teacher analytics
GET    /api/v1/analytics/teacher/{teacherId}  # Specific teacher analytics

# Session-Level Analytics
GET    /api/v1/analytics/session/{sessionId}              # Session overview
GET    /api/v1/analytics/session/{sessionId}/overview     # Detailed overview
GET    /api/v1/analytics/session/{sessionId}/groups       # Group breakdown

# System-Level Analytics (Admin Only)
GET    /api/v1/analytics/system               # System metrics
GET    /api/v1/analytics/effectiveness        # Effectiveness reports
GET    /api/v1/analytics/dashboard/realtime   # Real-time dashboard
```

#### **Health & Monitoring**
```
GET    /api/v1/health                         # Basic health check
GET    /api/v1/health/guidance                # Detailed system health
GET    /api/v1/health/components              # Component-level health
```

#### **Admin Operations**
```
GET    /api/v1/admin/schools                  # List schools
POST   /api/v1/admin/schools                  # Create school
PUT    /api/v1/admin/schools/{id}             # Update school
GET    /api/v1/admin/analytics                # Platform analytics
```

---

## 🔄 Migration Strategy

### **Implementation Phases**

#### **Phase 1: Add New Routes** ✅ **COMPLETE**
- Add frontend-compatible routes alongside existing ones
- Both routes point to the same controller methods
- Zero impact on existing integrations

#### **Phase 2: Update Frontend** ✅ **COMPLETE** 
- Update API clients to use new route patterns
- Update React Query keys to reflect new patterns
- Maintain backward compatibility during transition

#### **Phase 3: Update Tests** ✅ **COMPLETE**
- Update E2E tests to use new route patterns
- Validate both old and new routes work correctly
- Ensure comprehensive test coverage

#### **Phase 4: Documentation** ✅ **COMPLETE**
- Update API documentation
- Create route standards guide (this document)
- Document migration patterns

### **Future Migration Pattern**
For any new route standardization:

1. **Analyze Current Patterns**: Identify inconsistencies
2. **Design Standard Pattern**: Follow established principles
3. **Implement Dual Routes**: Add new routes, keep old ones
4. **Update Consumers**: Frontend, tests, documentation
5. **Monitor & Validate**: Ensure no regressions
6. **Document Changes**: Update guides and README

---

## 🛡️ Backward Compatibility Rules

### **Never Break Existing Routes**
- Always maintain original route paths
- Both old and new routes must work identically
- Use the same controller methods for both routes

### **Legacy Route Documentation**
When adding new standardized routes, document legacy routes:

```markdown
#### Route Standardization
**Primary Route**: `GET /api/v1/ai/insights/{sessionId}` (Recommended)
**Legacy Route**: `GET /api/v1/ai/sessions/{sessionId}/insights` (Maintained for compatibility)
```

### **Deprecation Process** (Future)
If routes must eventually be deprecated:
1. **Announce**: 6 months advance notice
2. **Warn**: Log warnings when legacy routes are used
3. **Document**: Clear migration path for consumers
4. **Remove**: Only after confirming zero usage

---

## ✅ Route Validation Checklist

Before implementing any new API route:

### **Design Review**
- [ ] Follows RESTful conventions
- [ ] Uses consistent resource naming
- [ ] Groups logically with related endpoints
- [ ] Matches frontend expectations

### **Implementation**
- [ ] Proper HTTP method selection
- [ ] Consistent parameter patterns (`:id` vs `{id}`)
- [ ] Appropriate response formats
- [ ] Error handling consistency

### **Testing**
- [ ] Unit tests for controller methods
- [ ] Integration tests for full request flow
- [ ] E2E tests covering realistic scenarios
- [ ] Error condition testing

### **Documentation**
- [ ] Updated API reference documentation
- [ ] Clear request/response examples
- [ ] Authentication requirements specified
- [ ] Rate limiting information included

### **Compatibility**
- [ ] No breaking changes to existing routes
- [ ] Legacy routes maintained if applicable
- [ ] Frontend client compatibility verified
- [ ] Test suite updated accordingly

---

## 🔍 Common Patterns & Examples

### **Resource Identification**
```bash
# ✅ Good: Clear resource identification
GET /api/v1/sessions/123/analytics
GET /api/v1/analytics/session/123

# ❌ Avoid: Ambiguous or nested paths
GET /api/v1/sessions/123/data/analytics/report
```

### **Action Naming**
```bash
# ✅ Good: Standard REST actions
POST /api/v1/sessions/{id}/start
POST /api/v1/sessions/{id}/end

# ❌ Avoid: Non-standard or verbose actions  
POST /api/v1/sessions/{id}/initiate-session-start
```

### **Query Parameters**
```bash
# ✅ Good: Optional parameters for filtering
GET /api/v1/ai/insights/{sessionId}?includeHistory=true&tier=both&limit=10

# ❌ Avoid: Required path parameters as query params
GET /api/v1/ai/insights?sessionId=123
```

### **Response Consistency**
```typescript
// ✅ Standard response format
{
  "success": true,
  "data": { /* response data */ },
  "processingTime": 150
}

// Error response format
{
  "success": false,
  "error": "VALIDATION_ERROR",
  "message": "Detailed error message",
  "details": { /* validation details */ }
}
```

---

## 📊 Route Performance Guidelines

### **Caching Strategy**
- **Static Data**: Use appropriate cache headers
- **User-Specific Data**: Include user context in cache keys
- **Real-time Data**: Short cache windows or no caching

### **Rate Limiting**
```typescript
// Route-specific rate limiting
'/api/v1/ai/analyze-discussion': 100 req/15min
'/api/v1/analytics/teacher': 50 req/5min
'/api/v1/health': 30 req/1min
```

### **Response Time Targets**
- **Health Checks**: < 100ms
- **Data Retrieval**: < 500ms
- **AI Analysis**: < 2s (Tier 1), < 5s (Tier 2)
- **Reports**: < 3s

---

## 🔐 Security Standards

### **Authentication Requirements**
```typescript
// Route-specific auth requirements
'/api/v1/health': 'none'              // Public
'/api/v1/sessions': 'teacher'         // Teacher auth required
'/api/v1/admin/*': 'super_admin'      // Admin only
```

### **Input Validation**
All routes must use Zod schemas for validation:
```typescript
// Parameter validation
export const sessionParamsSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID format')
});

// Query parameter validation  
export const sessionInsightsQuerySchema = z.object({
  includeHistory: z.enum(['true', 'false']).transform(val => val === 'true'),
  tier: z.enum(['tier1', 'tier2', 'both']).optional().default('both')
});
```

---

## 📝 Implementation Examples

### **Example 1: Adding New Analytics Endpoint**

**1. Design the Route**
```
GET /api/v1/analytics/effectiveness/{reportType}
```

**2. Implement Controller**
```typescript
export const getEffectivenessReport = async (req: AuthRequest, res: Response) => {
  const { reportType } = req.params;
  const query = req.query;
  
  // Implementation...
  
  return res.json({
    success: true,
    data: reportData,
    processingTime: Date.now() - startTime
  });
};
```

**3. Add Route Definition**
```typescript
router.get('/effectiveness/:reportType',
  rateLimiter,
  validateParams(reportParamsSchema),
  validateQuery(reportQuerySchema),
  analyticsController.getEffectivenessReport
);
```

**4. Update Documentation**
```markdown
| `GET` | `/api/v1/analytics/effectiveness/{reportType}` | Generate effectiveness report | Teacher |
```

### **Example 2: Standardizing Existing Routes**

**Current Route (Legacy)**
```
POST /api/v1/sessions/{sessionId}/groups/{groupId}/analyze
```

**Proposed Standard Route**
```
POST /api/v1/ai/analyze-group
```

**Implementation Strategy**
1. Add new route pointing to same controller
2. Update frontend to use new route
3. Update tests to validate both routes
4. Document both routes with migration guidance

---

## 🚀 Future Considerations

### **API Versioning Strategy**
- Current: `/api/v1/`
- Future major changes: `/api/v2/`
- Maintain v1 compatibility for minimum 1 year

### **GraphQL Migration** (Future Consideration)
If GraphQL is adopted:
- Maintain REST endpoints for backward compatibility
- GraphQL as additive enhancement, not replacement
- Follow same resource naming conventions

### **Microservices Architecture** (Future)
Route patterns should remain consistent across services:
```
https://sessions.classwaves.com/api/v1/sessions
https://ai.classwaves.com/api/v1/ai/analyze-discussion
https://analytics.classwaves.com/api/v1/analytics/teacher
```

---

## 📞 Support & Feedback

### **Questions & Clarifications**
- **Technical Questions**: Consult with backend development team
- **Design Decisions**: Architecture review required for new patterns
- **Breaking Changes**: Requires senior developer approval

### **Standards Updates**
This guide should be updated when:
- New route categories are established
- Major API changes are implemented  
- Performance or security requirements change
- Developer feedback indicates improvements needed

---

## 📚 Related Documentation

- [Backend README.md](../README.md) - Complete API reference
- [Frontend Integration Patterns](../../classwaves-frontend/docs/API_INTEGRATION_PATTERNS.md) - Frontend consumption patterns
- [E2E Testing Guide](../../classwaves-frontend/tests/e2e/INTEGRATION_GUIDE.md) - Testing standardized routes

---

## 📋 Change Log

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| Dec 2024 | 1.0 | Initial guide creation following Route Standardization Implementation | ClassWaves QA Guardian |

---

**This document serves as the authoritative guide for all API route design decisions in the ClassWaves platform.**
