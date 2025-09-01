# Technical PRD: Dashboard Metrics Implementation

## 📋 Executive Summary

This document outlines the implementation of real-time dashboard metrics to replace hardcoded "0" values in the ClassWaves teacher dashboard. **IMPORTANT**: This implementation was done without proper requirements gathering and represents assumptions that should be validated.

---

## 🚨 Critical Gaps in Requirements (Should Have Been Discussed First)

### **Business Requirements Missing**
- ❓ **What metrics matter most to teachers?** (engagement, completion rates, attendance?)
- ❓ **What time periods are relevant?** (today, this week, current semester?)
- ❓ **How should metrics be aggregated?** (per session, per class, per student?)
- ❓ **What constitutes "success" for each metric?** (thresholds, goals, benchmarks?)

### **User Experience Questions Not Asked**
- ❓ **How often do teachers check dashboard metrics?** (affects refresh strategy)
- ❓ **What actions should metrics enable?** (drill-down, filtering, alerts?)
- ❓ **What's the primary use case?** (daily planning, weekly review, real-time monitoring?)
- ❓ **How do teachers currently track these metrics manually?**

### **Technical Architecture Assumptions Made**
- ❓ **Data freshness requirements?** (real-time vs. batched updates)
- ❓ **Performance constraints?** (query cost, latency requirements)
- ❓ **Caching strategy?** (edge caching, database query optimization)
- ❓ **Scalability needs?** (1 teacher vs. 1000 teachers loading simultaneously)

---

## 🎯 Current Implementation (What Was Built)

### **Metrics Implemented**

#### 1. Active Sessions
```sql
SELECT COUNT(*) as count
FROM classwaves.sessions.classroom_sessions 
WHERE teacher_id = ? AND status = 'active'
```
**Assumptions Made:**
- "Active" means `status = 'active'` in database
- Count includes all active sessions regardless of student participation
- No time boundaries (could include sessions active for days)

**Questions to Validate:**
- Should this be "sessions with active students" instead?
- Should there be a maximum session duration before it's considered stale?
- Does "active" mean currently in progress or just not ended?

#### 2. Today's Sessions  
```sql
SELECT COUNT(*) as count
FROM classwaves.sessions.classroom_sessions 
WHERE teacher_id = ? 
AND (DATE(scheduled_start) = CURRENT_DATE() OR DATE(created_at) = CURRENT_DATE())
```
**Assumptions Made:**
- "Today" uses database server timezone
- Includes both scheduled and created sessions
- No distinction between completed vs. upcoming today

**Questions to Validate:**
- Should this be "upcoming today" vs. "completed today"?
- Should timezone be teacher's local time vs. school time vs. server time?
- What about sessions that span multiple days?

#### 3. Total Students
```sql
SELECT COALESCE(SUM(current_size), 0) as count
FROM classwaves.sessions.student_groups g
INNER JOIN classwaves.sessions.classroom_sessions s ON g.session_id = s.id
WHERE s.teacher_id = ?
```
**Assumptions Made:**
- Counts current group sizes across all sessions (active and inactive)
- No deduplication (same student in multiple sessions counted multiple times)
- Includes groups from ended/archived sessions

**Questions to Validate:**
- Should this be unique students across all sessions?
- Should it only count students in active sessions?
- How do we handle students who left groups?

---

## 🏗️ Technical Architecture (Current Implementation)

### **API Endpoint**
- **Path**: `GET /api/v1/sessions/dashboard-metrics`
- **Authentication**: Required (teacher JWT)
- **Caching**: None implemented (every request hits database)
- **Rate Limiting**: Inherits from global session routes

### **Frontend Integration**
- **Technology**: React Query with 60-second auto-refresh
- **Caching**: 30-second stale time (frontend only)
- **Error Handling**: Shows "--" with error message
- **Loading States**: Spinners during API calls

### **Database Performance**
- **Query Count**: 3 separate queries per dashboard load
- **Indexing**: Relies on existing `teacher_id` and `status` indexes
- **Cost**: ~$0.01-0.05 per dashboard load (Databricks pricing)

---

## ⚠️ Technical Concerns & Assumptions

### **Performance Issues Not Addressed**
1. **N+1 Problem**: Each dashboard load = 3 database queries
2. **No Caching**: Every teacher dashboard hit queries database fresh  
3. **Concurrent Load**: 100 teachers loading dashboard = 300 queries
4. **Cost Scaling**: Could become expensive at scale without query optimization

### **Data Accuracy Questions**
1. **Timezone Handling**: Uses database server time, not teacher local time
2. **Real-time vs. Eventually Consistent**: Queries live data but no event-driven updates
3. **Cross-Session Student Counting**: May double-count students in multiple groups
4. **Stale Session Detection**: No logic to detect "zombie" active sessions

### **User Experience Gaps**
1. **No Context**: Numbers without trends, comparisons, or goals
2. **No Drill-down**: Can't click to see which sessions/students
3. **Limited Actionability**: Metrics don't suggest next actions
4. **No Personalization**: Same metrics for all teachers regardless of teaching style

---

## 📊 Alternative Approaches We Should Consider

### **Option A: Pre-aggregated Dashboard Tables**
```sql
-- Daily dashboard snapshots
CREATE TABLE teacher_dashboard_daily (
  teacher_id STRING,
  date DATE,
  active_sessions INT,
  completed_sessions INT,
  unique_students INT,
  avg_engagement DECIMAL,
  -- Updated via scheduled jobs
);
```
**Pros**: Fast queries, cost-effective at scale
**Cons**: Less real-time, requires batch processing

### **Option B: Real-time Event-Driven Metrics**
```typescript
// Update metrics via WebSocket events
sessionService.on('session.started', (event) => {
  dashboardMetrics.increment('active_sessions', event.teacherId);
});
```
**Pros**: True real-time, reduces database load
**Cons**: Complex state management, potential consistency issues

### **Option C: Teacher-Configurable Dashboards**
```typescript
interface TeacherDashboardConfig {
  metrics: Array<'active_sessions' | 'engagement_trends' | 'completion_rates'>;
  timeframe: 'today' | 'week' | 'month';
  refresh_rate: number;
}
```
**Pros**: Personalized experience, flexible
**Cons**: More complex UI/UX, additional configuration burden

---

## 🤝 What We Should Have Discussed First

### **1. Business Context Questions**
- What's the primary goal of the dashboard? (daily planning, performance monitoring, student tracking?)
- What metrics do teachers currently track manually?
- What decisions should these metrics inform?
- How do these metrics tie to school/district KPIs?

### **2. User Research Needed**
- Interview 3-5 teachers about their daily workflow
- Shadow teachers during dashboard usage
- Analyze which metrics correlate with teacher retention/satisfaction
- A/B test different metric presentations

### **3. Technical Trade-offs Discussion**
- Real-time accuracy vs. cost efficiency
- Simple implementation vs. scalable architecture  
- Generic metrics vs. personalized insights
- Current sprint vs. future roadmap planning

### **4. Success Metrics for the Feature**
- How will we measure if this dashboard is valuable?
- What's the acceptable query cost per teacher per day?
- What's the target dashboard load time?
- How do we handle database outages gracefully?

---

## 🔄 Proposed Collaborative Process Going Forward

### **Phase 1: Requirements Validation** (Should have been done first)
1. **Stakeholder Interviews**: 30-min sessions with 3-5 teachers
2. **Usage Analytics**: Review existing dashboard interaction patterns
3. **Competitive Analysis**: How do similar EdTech products handle teacher dashboards?
4. **Business Requirements**: Define success criteria and constraints

### **Phase 2: Technical Design Review**
1. **Architecture Options**: Present 3 approaches with trade-offs
2. **Performance Modeling**: Estimate costs and latency under load
3. **Database Impact**: Analyze query patterns and optimization needs
4. **Caching Strategy**: Design for both performance and data freshness

### **Phase 3: Iterative Implementation**
1. **MVP Metrics**: Start with 1-2 most valuable metrics
2. **A/B Testing**: Compare metric presentations and update frequencies
3. **Performance Monitoring**: Track query costs and user satisfaction
4. **Gradual Rollout**: Teacher-by-teacher or school-by-school deployment

---

## 🎯 Immediate Next Steps (Recommendations)

### **1. Validate Current Implementation**
- [ ] Interview 2-3 teachers about metric relevance
- [ ] Analyze query performance under realistic load
- [ ] A/B test current metrics vs. empty state

### **2. Fix Technical Issues**
- [ ] Add query result caching (Redis, 5-minute TTL)
- [ ] Combine 3 queries into 1 optimized query
- [ ] Add proper error handling and fallback values
- [ ] Implement timezone-aware date calculations

### **3. Enhance User Experience**
- [ ] Add trend indicators (↑↓ compared to last week)
- [ ] Include click-through to detailed views
- [ ] Show contextual help explaining each metric
- [ ] Add skeleton loading states instead of spinners

### **4. Long-term Architecture Planning**
- [ ] Design event-driven metric updates
- [ ] Plan for dashboard personalization
- [ ] Consider real-time vs. batch metric computation
- [ ] Evaluate dashboard as a separate microservice

---

## 💭 Lessons Learned

### **What I Should Have Done Better**
1. **Asked questions first** instead of making assumptions
2. **Presented options** rather than implementing one approach
3. **Considered business context** before diving into technical implementation
4. **Discussed trade-offs** around performance, cost, and user experience
5. **Planned for iteration** rather than building a complete solution immediately

### **Better Collaboration Approach**
1. **Start with "Why"**: What problem are we solving for teachers?
2. **Present trade-offs**: Show 2-3 approaches with pros/cons
3. **Get feedback early**: Share wireframes/designs before coding
4. **Iterate in small chunks**: Build one metric, get feedback, then continue
5. **Consider long-term**: How does this fit into the broader product vision?

---

## 📝 Questions for Product Discussion

1. **Metric Priority**: Which 1-2 metrics would be most valuable to teachers daily?
2. **Time Sensitivity**: How real-time do these metrics need to be?
3. **Performance Budget**: What's the acceptable cost/latency per dashboard load?
4. **User Journey**: What should teachers do after seeing these metrics?
5. **Success Measurement**: How will we know if this dashboard improvement is working?

---

**Author**: Development Team  
**Status**: Implementation Complete (Requires Validation)  
**Next Review**: Product discussion to validate assumptions  
**Last Updated**: December 2024
