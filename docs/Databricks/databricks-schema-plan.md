# Databricks Schema Plan for ClassWaves

## Database Organization

### Catalog: `classwaves`
The production catalog for all ClassWaves data.

### Schema: `main`
The primary schema containing all application tables.

## Table Creation Order (Dependencies)

### Phase 1: Foundation Tables (No Dependencies)
1. **schools** - School organizations
2. **data_retention_policies** - Compliance policies

### Phase 2: User Tables (Depends on schools)
3. **teachers** - Teacher accounts
4. **registered_students** - Student accounts (COPPA compliant)

### Phase 3: Session Tables (Depends on teachers, schools)
5. **sessions** - Classroom sessions
6. **groups** - Session groups

### Phase 4: Participant Tables (Depends on sessions, groups)
7. **student_participants** - Active session participants
8. **parental_consent_records** - COPPA consent tracking

### Phase 5: Activity Tables (Depends on sessions, groups, participants)
9. **transcriptions** - Audio transcriptions
10. **messages** - Chat/text messages
11. **teacher_interventions** - Teacher actions

### Phase 6: Analytics Tables (Depends on sessions)
12. **session_analytics** - Overall session metrics
13. **group_analytics** - Group-level metrics
14. **student_analytics** - Individual metrics

### Phase 7: Compliance Tables (Can be created anytime)
15. **audit_log** - All system actions
16. **coppa_data_protection** - COPPA compliance tracking

## Key Design Decisions

1. **Partitioning Strategy**:
   - Schools table: Partitioned by subscription_tier
   - Teachers table: Partitioned by school_id
   - Sessions table: Partitioned by school_id and created_at date
   - Transcriptions: Partitioned by session_id and timestamp date
   - Analytics tables: Partitioned by analysis_type and timestamp

2. **Delta Table Features**:
   - Auto-optimize enabled for better performance
   - Auto-compact for small file management
   - Data skipping for faster queries

3. **Compliance Features**:
   - Audit log for all data access
   - Automatic data retention policies
   - COPPA-compliant minimal data storage
   - Parental consent tracking

4. **Performance Optimizations**:
   - Strategic indexes on frequently queried columns
   - Proper foreign key relationships
   - Optimized partition pruning

5. **Security Considerations**:
   - No PII stored for students under 13
   - Encrypted sensitive fields
   - Row-level security ready