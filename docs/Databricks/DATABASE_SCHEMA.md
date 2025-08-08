# ClassWaves Unity Catalog Database Schema

## Overview
- **Catalog:** `classwaves`
- **Host:** `https://dbc-d5db37cb-5441.cloud.databricks.com`
- **Warehouse ID:** `077a4c2149eade40`
- **Total Schemas:** 10
- **Total Tables:** 27

## Schemas

### 1. users - User Management
Contains core user entities: schools, teachers, and students.

#### Table: users.schools
**Purpose:** Stores school/institution information with subscription and compliance status.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique school identifier |
| name | STRING | NOT NULL | School name |
| domain | STRING | NOT NULL | School email domain |
| google_workspace_id | STRING | NULL | Google Workspace ID |
| admin_email | STRING | NOT NULL | Primary admin email |
| subscription_tier | STRING | NOT NULL | Subscription level (free/premium/enterprise) |
| subscription_status | STRING | NOT NULL | Status (active/trial/suspended) |
| max_teachers | INT | NOT NULL | Maximum allowed teachers |
| current_teachers | INT | NOT NULL | Current teacher count |
| stripe_customer_id | STRING | NULL | Stripe payment ID |
| subscription_start_date | TIMESTAMP | NULL | Subscription start |
| subscription_end_date | TIMESTAMP | NULL | Subscription end |
| trial_ends_at | TIMESTAMP | NULL | Trial expiration |
| ferpa_agreement | BOOLEAN | NOT NULL | FERPA compliance agreed |
| coppa_compliant | BOOLEAN | NOT NULL | COPPA compliance status |
| data_retention_days | INT | NOT NULL | Data retention period |
| created_at | TIMESTAMP | NOT NULL | Record creation |
| updated_at | TIMESTAMP | NOT NULL | Last update |

#### Table: users.teachers
**Purpose:** Teacher accounts with access control and activity tracking.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique teacher identifier |
| google_id | STRING | NOT NULL | Google account ID |
| email | STRING | NOT NULL | Teacher email |
| name | STRING | NOT NULL | Full name |
| picture | STRING | NULL | Profile picture URL |
| school_id | STRING | NOT NULL | Associated school (FK) |
| role | STRING | NOT NULL | Role (teacher/admin/super_admin) |
| status | STRING | NOT NULL | Status (active/suspended/deactivated) |
| access_level | STRING | NOT NULL | Access permissions |
| max_concurrent_sessions | INT | NOT NULL | Session limit |
| current_sessions | INT | NOT NULL | Active session count |
| grade | STRING | NULL | Teaching grade |
| subject | STRING | NULL | Teaching subject |
| timezone | STRING | NOT NULL | User timezone |
| features_enabled | STRING | NULL | Enabled features JSON |
| last_login | TIMESTAMP | NULL | Last login time |
| login_count | INT | NOT NULL | Total logins |
| total_sessions_created | INT | NOT NULL | Sessions created |
| created_at | TIMESTAMP | NOT NULL | Record creation |
| updated_at | TIMESTAMP | NOT NULL | Last update |

#### Table: users.students
**Purpose:** Student profiles with parental consent tracking.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique student identifier |
| display_name | STRING | NOT NULL | Display name (anonymized) |
| school_id | STRING | NOT NULL | Associated school (FK) |
| email | STRING | NULL | Student email (if allowed) |
| google_id | STRING | NULL | Google account (if used) |
| status | STRING | NOT NULL | Status (active/inactive) |
| grade_level | STRING | NULL | Current grade |
| has_parental_consent | BOOLEAN | NOT NULL | Consent obtained |
| consent_date | TIMESTAMP | NULL | Consent timestamp |
| parent_email | STRING | NULL | Parent contact |
| data_sharing_consent | BOOLEAN | NOT NULL | Data sharing allowed |
| audio_recording_consent | BOOLEAN | NOT NULL | Recording allowed |
| created_at | TIMESTAMP | NOT NULL | Record creation |
| updated_at | TIMESTAMP | NOT NULL | Last update |

### 2. sessions - Classroom Session Management
Manages real-time classroom sessions and participant tracking.

#### Table: sessions.classroom_sessions
**Purpose:** Core session information and configuration.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique session identifier |
| title | STRING | NOT NULL | Session title |
| description | STRING | NULL | Session description |
| status | STRING | NOT NULL | Status (created/active/paused/ended) |
| scheduled_start | TIMESTAMP | NULL | Planned start time |
| actual_start | TIMESTAMP | NULL | Actual start time |
| actual_end | TIMESTAMP | NULL | End time |
| planned_duration_minutes | INT | NOT NULL | Expected duration |
| actual_duration_minutes | INT | NULL | Actual duration |
| max_students | INT | NOT NULL | Student limit |
| target_group_size | INT | NOT NULL | Ideal group size |
| auto_group_enabled | BOOLEAN | NOT NULL | Auto-grouping enabled |
| teacher_id | STRING | NOT NULL | Teacher (FK) |
| school_id | STRING | NOT NULL | School (FK) |
| recording_enabled | BOOLEAN | NOT NULL | Recording allowed |
| transcription_enabled | BOOLEAN | NOT NULL | Transcription enabled |
| ai_analysis_enabled | BOOLEAN | NOT NULL | AI analysis enabled |
| ferpa_compliant | BOOLEAN | NOT NULL | FERPA compliance |
| coppa_compliant | BOOLEAN | NOT NULL | COPPA compliance |
| recording_consent_obtained | BOOLEAN | NOT NULL | Consent status |
| data_retention_date | TIMESTAMP | NULL | Data deletion date |
| total_groups | INT | NOT NULL | Group count |
| total_students | INT | NOT NULL | Student count |
| participation_rate | DECIMAL(5,2) | NOT NULL | Participation % |
| engagement_score | DECIMAL(5,2) | NOT NULL | Engagement metric |
| created_at | TIMESTAMP | NOT NULL | Record creation |
| updated_at | TIMESTAMP | NOT NULL | Last update |

#### Table: sessions.student_groups
**Purpose:** Breakout groups within sessions.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique group identifier |
| session_id | STRING | NOT NULL | Parent session (FK) |
| name | STRING | NOT NULL | Group name |
| group_number | INT | NOT NULL | Group number |
| status | STRING | NOT NULL | Status (active/paused/ended) |
| max_size | INT | NOT NULL | Maximum members |
| current_size | INT | NOT NULL | Current members |
| auto_managed | BOOLEAN | NOT NULL | AI-managed group |
| start_time | TIMESTAMP | NULL | Group start time |
| end_time | TIMESTAMP | NULL | Group end time |
| total_speaking_time_seconds | INT | NULL | Total talk time |
| participation_balance | DECIMAL(5,2) | NULL | Balance score |
| collaboration_score | DECIMAL(5,2) | NULL | Collaboration metric |
| topic_focus_score | DECIMAL(5,2) | NULL | On-topic score |
| created_at | TIMESTAMP | NOT NULL | Record creation |
| updated_at | TIMESTAMP | NOT NULL | Last update |

#### Table: sessions.participants
**Purpose:** Individual participant tracking in sessions.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique participant ID |
| session_id | STRING | NOT NULL | Session (FK) |
| group_id | STRING | NULL | Current group (FK) |
| student_id | STRING | NULL | Student ID (FK) |
| anonymous_id | STRING | NULL | Anonymous identifier |
| display_name | STRING | NOT NULL | Display name |
| join_time | TIMESTAMP | NOT NULL | Join timestamp |
| leave_time | TIMESTAMP | NULL | Leave timestamp |
| is_active | BOOLEAN | NOT NULL | Currently active |
| device_type | STRING | NULL | Device info |
| browser_info | STRING | NULL | Browser details |
| connection_quality | STRING | NULL | Connection status |
| can_speak | BOOLEAN | NOT NULL | Audio enabled |
| can_hear | BOOLEAN | NOT NULL | Can hear audio |
| is_muted | BOOLEAN | NOT NULL | Currently muted |
| total_speaking_time_seconds | INT | NULL | Talk time |
| message_count | INT | NULL | Messages sent |
| interaction_count | INT | NULL | Interactions |
| created_at | TIMESTAMP | NOT NULL | Record creation |
| updated_at | TIMESTAMP | NOT NULL | Last update |

#### Table: sessions.transcriptions
**Purpose:** Speech-to-text transcriptions from sessions.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique transcription ID |
| session_id | STRING | NOT NULL | Session (FK) |
| group_id | STRING | NULL | Group (FK) |
| speaker_id | STRING | NOT NULL | Speaker identifier |
| speaker_type | STRING | NOT NULL | Type (teacher/student) |
| speaker_name | STRING | NOT NULL | Display name |
| content | STRING | NOT NULL | Transcribed text |
| language_code | STRING | NOT NULL | Language (en-US) |
| start_time | TIMESTAMP | NOT NULL | Speech start |
| end_time | TIMESTAMP | NOT NULL | Speech end |
| duration_seconds | DECIMAL(10,3) | NOT NULL | Duration |
| confidence_score | DECIMAL(5,4) | NOT NULL | STT confidence |
| is_final | BOOLEAN | NOT NULL | Final transcription |
| sentiment | STRING | NULL | Sentiment analysis |
| key_phrases | STRING | NULL | Extracted phrases |
| academic_vocabulary_detected | BOOLEAN | NULL | Academic language |
| created_at | TIMESTAMP | NOT NULL | Record creation |

### 3. analytics - Educational Metrics and Analysis
Stores calculated metrics and analytics data.

#### Table: analytics.session_metrics
**Purpose:** Overall session performance metrics.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique metric ID |
| session_id | STRING | NOT NULL | Session (FK) |
| calculation_timestamp | TIMESTAMP | NOT NULL | Calculation time |
| total_students | INT | NOT NULL | Total participants |
| active_students | INT | NOT NULL | Active participants |
| participation_rate | DECIMAL(5,2) | NOT NULL | Participation % |
| average_speaking_time_seconds | DECIMAL(10,2) | NULL | Avg talk time |
| speaking_time_std_dev | DECIMAL(10,2) | NULL | Talk time variance |
| overall_engagement_score | DECIMAL(5,2) | NOT NULL | Engagement metric |
| attention_score | DECIMAL(5,2) | NULL | Attention metric |
| interaction_score | DECIMAL(5,2) | NULL | Interaction metric |
| collaboration_score | DECIMAL(5,2) | NULL | Collaboration metric |
| on_topic_percentage | DECIMAL(5,2) | NULL | On-topic % |
| academic_vocabulary_usage | DECIMAL(5,2) | NULL | Academic language % |
| question_asking_rate | DECIMAL(5,2) | NULL | Question frequency |
| group_formation_time_seconds | INT | NULL | Grouping time |
| average_group_size | DECIMAL(5,2) | NULL | Avg group size |
| group_stability_score | DECIMAL(5,2) | NULL | Group stability |
| average_connection_quality | DECIMAL(5,2) | NULL | Connection quality |
| technical_issues_count | INT | NULL | Tech problems |
| created_at | TIMESTAMP | NOT NULL | Record creation |

#### Table: analytics.group_metrics
**Purpose:** Breakout group performance analysis.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique metric ID |
| group_id | STRING | NOT NULL | Group (FK) |
| session_id | STRING | NOT NULL | Session (FK) |
| calculation_timestamp | TIMESTAMP | NOT NULL | Calculation time |
| participation_equality_index | DECIMAL(5,4) | NULL | Equality metric |
| dominant_speaker_percentage | DECIMAL(5,2) | NULL | Dominance % |
| silent_members_count | INT | NULL | Silent members |
| turn_taking_score | DECIMAL(5,2) | NULL | Turn-taking metric |
| interruption_rate | DECIMAL(5,2) | NULL | Interruption frequency |
| supportive_interactions_count | INT | NULL | Support instances |
| topic_coherence_score | DECIMAL(5,2) | NULL | Topic focus |
| vocabulary_diversity_score | DECIMAL(5,2) | NULL | Vocabulary range |
| academic_discourse_score | DECIMAL(5,2) | NULL | Academic level |
| average_sentiment_score | DECIMAL(5,2) | NULL | Group sentiment |
| emotional_support_instances | INT | NULL | Support events |
| conflict_instances | INT | NULL | Conflict events |
| created_at | TIMESTAMP | NOT NULL | Record creation |

#### Table: analytics.student_metrics
**Purpose:** Individual student performance tracking.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique metric ID |
| participant_id | STRING | NOT NULL | Participant (FK) |
| session_id | STRING | NOT NULL | Session (FK) |
| calculation_timestamp | TIMESTAMP | NOT NULL | Calculation time |
| total_speaking_time_seconds | INT | NOT NULL | Total talk time |
| speaking_turns_count | INT | NULL | Number of turns |
| average_turn_duration_seconds | DECIMAL(10,2) | NULL | Avg turn length |
| participation_score | DECIMAL(5,2) | NULL | Participation metric |
| initiative_score | DECIMAL(5,2) | NULL | Initiative metric |
| responsiveness_score | DECIMAL(5,2) | NULL | Response metric |
| vocabulary_complexity_score | DECIMAL(5,2) | NULL | Vocabulary level |
| grammar_accuracy_score | DECIMAL(5,2) | NULL | Grammar accuracy |
| fluency_score | DECIMAL(5,2) | NULL | Fluency metric |
| peer_interaction_count | INT | NULL | Peer interactions |
| supportive_comments_count | INT | NULL | Support given |
| questions_asked_count | INT | NULL | Questions asked |
| average_sentiment | DECIMAL(5,2) | NULL | Sentiment score |
| confidence_level | DECIMAL(5,2) | NULL | Confidence metric |
| stress_indicators_count | INT | NULL | Stress signals |
| created_at | TIMESTAMP | NOT NULL | Record creation |

#### Table: analytics.educational_metrics
**Purpose:** Generic educational metrics storage.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique metric ID |
| session_id | STRING | NOT NULL | Session (FK) |
| metric_type | STRING | NOT NULL | Metric category |
| metric_name | STRING | NOT NULL | Metric name |
| metric_value | DECIMAL(10,4) | NULL | Numeric value |
| metric_metadata | MAP<STRING,STRING> | NULL | Additional data |
| aggregation_level | STRING | NULL | Level (session/group/student) |
| calculation_timestamp | TIMESTAMP | NOT NULL | Calculation time |
| created_at | TIMESTAMP | NOT NULL | Record creation |

### 4. compliance - FERPA/COPPA Compliance Management
Ensures educational data privacy compliance.

#### Table: compliance.audit_log
**Purpose:** Comprehensive audit trail for all system actions.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique audit ID |
| actor_id | STRING | NOT NULL | User performing action |
| actor_type | STRING | NOT NULL | Type (teacher/student/system) |
| event_type | STRING | NOT NULL | Event name |
| event_category | STRING | NOT NULL | Category (auth/session/data) |
| event_timestamp | TIMESTAMP | NOT NULL | Event time |
| resource_type | STRING | NOT NULL | Resource affected |
| resource_id | STRING | NULL | Resource identifier |
| school_id | STRING | NOT NULL | School context |
| session_id | STRING | NULL | Session context |
| description | STRING | NOT NULL | Human-readable description |
| ip_address | STRING | NULL | Client IP |
| user_agent | STRING | NULL | Client info |
| compliance_basis | STRING | NULL | Legal basis |
| data_accessed | STRING | NULL | Data accessed |
| affected_student_ids | STRING | NULL | Students affected |
| created_at | TIMESTAMP | NOT NULL | Record creation |

#### Table: compliance.parental_consents
**Purpose:** Tracks parental consent for student participation.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique consent ID |
| student_id | STRING | NOT NULL | Student (FK) |
| school_id | STRING | NOT NULL | School (FK) |
| consent_type | STRING | NOT NULL | Type of consent |
| consent_given | BOOLEAN | NOT NULL | Consent status |
| consent_date | TIMESTAMP | NOT NULL | Consent timestamp |
| parent_name | STRING | NOT NULL | Parent name |
| parent_email | STRING | NOT NULL | Parent email |
| relationship | STRING | NOT NULL | Parent relationship |
| verification_method | STRING | NOT NULL | How verified |
| verification_token | STRING | NULL | Verification token |
| verified_at | TIMESTAMP | NULL | Verification time |
| ip_address | STRING | NULL | Consent IP |
| user_agent | STRING | NULL | Consent device |
| consent_text_version | STRING | NOT NULL | Terms version |
| expires_at | TIMESTAMP | NULL | Expiration date |
| revoked_at | TIMESTAMP | NULL | Revocation date |
| created_at | TIMESTAMP | NOT NULL | Record creation |
| updated_at | TIMESTAMP | NOT NULL | Last update |

#### Table: compliance.retention_policies
**Purpose:** Data retention configuration by school.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique policy ID |
| school_id | STRING | NOT NULL | School (FK) |
| policy_type | STRING | NOT NULL | Data type |
| retention_days | INT | NOT NULL | Keep days |
| delete_after_days | INT | NULL | Delete after |
| archive_after_days | INT | NULL | Archive after |
| legal_basis | STRING | NOT NULL | Legal requirement |
| auto_delete_enabled | BOOLEAN | NOT NULL | Auto-delete on |
| created_at | TIMESTAMP | NOT NULL | Record creation |
| updated_at | TIMESTAMP | NOT NULL | Last update |

#### Table: compliance.coppa_compliance
**Purpose:** COPPA-specific compliance tracking for under-13 students.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique record ID |
| student_id | STRING | NOT NULL | Student (FK) |
| school_id | STRING | NOT NULL | School (FK) |
| birth_year | INT | NULL | Birth year |
| is_under_13 | BOOLEAN | NOT NULL | Under 13 flag |
| age_verification_method | STRING | NULL | How verified |
| age_verified_at | TIMESTAMP | NULL | Verification time |
| data_collection_limited | BOOLEAN | NOT NULL | Limited collection |
| no_behavioral_targeting | BOOLEAN | NOT NULL | No targeting |
| no_third_party_sharing | BOOLEAN | NOT NULL | No sharing |
| auto_delete_enabled | BOOLEAN | NOT NULL | Auto-delete on |
| delete_after_days | INT | NULL | Delete timeline |
| deletion_requested_at | TIMESTAMP | NULL | Delete request |
| deletion_completed_at | TIMESTAMP | NULL | Delete complete |
| parent_access_enabled | BOOLEAN | NOT NULL | Parent access |
| parent_last_reviewed | TIMESTAMP | NULL | Parent review |
| created_at | TIMESTAMP | NOT NULL | Record creation |
| updated_at | TIMESTAMP | NOT NULL | Last update |

### 5. ai_insights - AI Analysis Results
Stores AI-generated insights and recommendations.

#### Table: ai_insights.analysis_results
**Purpose:** Raw AI analysis outputs.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique result ID |
| session_id | STRING | NOT NULL | Session (FK) |
| analysis_type | STRING | NOT NULL | Analysis type |
| analysis_timestamp | TIMESTAMP | NOT NULL | Analysis time |
| processing_time_ms | INT | NOT NULL | Processing duration |
| result_data | STRING | NOT NULL | JSON results |
| confidence_score | DECIMAL(5,4) | NULL | Confidence level |
| model_version | STRING | NOT NULL | AI model version |
| created_at | TIMESTAMP | NOT NULL | Record creation |

#### Table: ai_insights.intervention_suggestions
**Purpose:** AI-suggested teacher interventions.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique suggestion ID |
| session_id | STRING | NOT NULL | Session (FK) |
| group_id | STRING | NULL | Group (FK) |
| teacher_id | STRING | NOT NULL | Teacher (FK) |
| intervention_type | STRING | NOT NULL | Intervention type |
| urgency | STRING | NOT NULL | Urgency level |
| reason | STRING | NOT NULL | Why suggested |
| suggested_action | STRING | NOT NULL | What to do |
| target_type | STRING | NOT NULL | Target (student/group) |
| target_student_id | STRING | NULL | Specific student |
| status | STRING | NOT NULL | Status (pending/acted) |
| acted_upon | BOOLEAN | NULL | Action taken |
| acted_at | TIMESTAMP | NULL | Action time |
| was_effective | BOOLEAN | NULL | Effectiveness |
| created_at | TIMESTAMP | NOT NULL | Record creation |

#### Table: ai_insights.educational_insights
**Purpose:** Educational insights and recommendations.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique insight ID |
| session_id | STRING | NOT NULL | Session (FK) |
| insight_type | STRING | NOT NULL | Insight category |
| title | STRING | NOT NULL | Insight title |
| description | STRING | NOT NULL | Full description |
| recommendations | STRING | NULL | Suggested actions |
| impact_score | DECIMAL(5,2) | NULL | Potential impact |
| confidence_level | DECIMAL(5,2) | NULL | Confidence |
| applies_to_type | STRING | NOT NULL | Target type |
| applies_to_id | STRING | NULL | Target ID |
| created_at | TIMESTAMP | NOT NULL | Record creation |

### 6. operational - System Operations
Monitors system health and operations.

#### Table: operational.system_events
**Purpose:** System-level event logging.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique event ID |
| event_type | STRING | NOT NULL | Event type |
| severity | STRING | NOT NULL | Severity level |
| component | STRING | NOT NULL | System component |
| message | STRING | NOT NULL | Event message |
| error_details | STRING | NULL | Error details |
| school_id | STRING | NULL | School context |
| session_id | STRING | NULL | Session context |
| user_id | STRING | NULL | User context |
| created_at | TIMESTAMP | NOT NULL | Event time |

#### Table: operational.api_metrics
**Purpose:** API performance tracking.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique metric ID |
| endpoint | STRING | NOT NULL | API endpoint |
| method | STRING | NOT NULL | HTTP method |
| response_time_ms | INT | NOT NULL | Response time |
| status_code | INT | NOT NULL | HTTP status |
| user_id | STRING | NULL | User making request |
| school_id | STRING | NULL | School context |
| ip_address | STRING | NULL | Client IP |
| user_agent | STRING | NULL | Client info |
| timestamp | TIMESTAMP | NOT NULL | Request time |

#### Table: operational.background_jobs
**Purpose:** Background job tracking and management.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique job ID |
| job_type | STRING | NOT NULL | Job type |
| status | STRING | NOT NULL | Job status |
| scheduled_at | TIMESTAMP | NOT NULL | Schedule time |
| started_at | TIMESTAMP | NULL | Start time |
| completed_at | TIMESTAMP | NULL | Complete time |
| parameters | STRING | NULL | Job parameters |
| result | STRING | NULL | Job result |
| error_message | STRING | NULL | Error if failed |
| retry_count | INT | NOT NULL | Retry attempts |
| created_at | TIMESTAMP | NOT NULL | Record creation |
| updated_at | TIMESTAMP | NOT NULL | Last update |

### 7. admin - Administrative Configuration
School and district administration.

#### Table: admin.districts
**Purpose:** School district management.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique district ID |
| name | STRING | NOT NULL | District name |
| state | STRING | NOT NULL | State/Province |
| region | STRING | NULL | Region |
| superintendent_name | STRING | NULL | Leader name |
| contact_email | STRING | NULL | Contact email |
| contact_phone | STRING | NULL | Contact phone |
| website | STRING | NULL | District website |
| student_count | INT | NULL | Total students |
| school_count | INT | NULL | Total schools |
| teacher_count | INT | NULL | Total teachers |
| subscription_tier | STRING | NOT NULL | Subscription level |
| contract_details | MAP<STRING,STRING> | NULL | Contract info |
| is_active | BOOLEAN | NOT NULL | Active status |
| created_at | TIMESTAMP | NOT NULL | Record creation |
| updated_at | TIMESTAMP | NOT NULL | Last update |

#### Table: admin.school_settings
**Purpose:** School-specific configuration settings.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique setting ID |
| school_id | STRING | NOT NULL | School (FK) |
| setting_key | STRING | NOT NULL | Setting name |
| setting_value | STRING | NOT NULL | Setting value |
| setting_type | STRING | NOT NULL | Value type |
| description | STRING | NULL | Setting description |
| is_editable | BOOLEAN | NOT NULL | Can be changed |
| created_at | TIMESTAMP | NOT NULL | Record creation |
| updated_at | TIMESTAMP | NOT NULL | Last update |

### 8. communication - Messaging System
Internal messaging and communication.

#### Table: communication.messages
**Purpose:** Internal messaging between users.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique message ID |
| session_id | STRING | NULL | Session context |
| sender_id | STRING | NOT NULL | Sender ID |
| sender_type | STRING | NOT NULL | Sender type |
| recipient_id | STRING | NULL | Recipient ID |
| recipient_type | STRING | NULL | Recipient type |
| message_type | STRING | NOT NULL | Message type |
| subject | STRING | NULL | Message subject |
| content | STRING | NOT NULL | Message content |
| metadata | MAP<STRING,STRING> | NULL | Extra data |
| is_read | BOOLEAN | NOT NULL | Read status |
| is_archived | BOOLEAN | NOT NULL | Archive status |
| is_deleted | BOOLEAN | NOT NULL | Delete status |
| created_at | TIMESTAMP | NOT NULL | Send time |
| read_at | TIMESTAMP | NULL | Read time |
| deleted_at | TIMESTAMP | NULL | Delete time |

### 9. audio - Audio Recording Management
Manages audio recordings and processing.

#### Table: audio.recordings
**Purpose:** Audio recording metadata and processing status.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique recording ID |
| session_id | STRING | NOT NULL | Session (FK) |
| group_id | STRING | NULL | Group (FK) |
| participant_id | STRING | NULL | Participant (FK) |
| file_path | STRING | NOT NULL | Storage path |
| file_size_bytes | BIGINT | NULL | File size |
| duration_seconds | INT | NULL | Duration |
| format | STRING | NOT NULL | Audio format |
| sample_rate | INT | NOT NULL | Sample rate |
| channels | INT | NOT NULL | Audio channels |
| codec | STRING | NULL | Audio codec |
| is_processed | BOOLEAN | NOT NULL | Processing status |
| transcription_status | STRING | NOT NULL | Transcription status |
| processing_attempts | INT | NOT NULL | Process attempts |
| last_error | STRING | NULL | Last error |
| created_at | TIMESTAMP | NOT NULL | Record creation |
| processed_at | TIMESTAMP | NULL | Process time |

### 10. notifications - Notification Management
Handles system notifications and alerts.

#### Table: notifications.templates
**Purpose:** Notification template management.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique template ID |
| name | STRING | NOT NULL | Template name |
| description | STRING | NULL | Template description |
| channel | STRING | NOT NULL | Delivery channel |
| category | STRING | NOT NULL | Template category |
| subject_template | STRING | NULL | Subject template |
| body_template | STRING | NOT NULL | Body template |
| variables | ARRAY<STRING> | NULL | Template variables |
| is_active | BOOLEAN | NOT NULL | Active status |
| version | INT | NOT NULL | Template version |
| created_by | STRING | NULL | Creator ID |
| created_at | TIMESTAMP | NOT NULL | Record creation |
| updated_at | TIMESTAMP | NOT NULL | Last update |

#### Table: notifications.notification_queue
**Purpose:** Notification delivery queue.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | STRING | NOT NULL | Unique notification ID |
| user_id | STRING | NOT NULL | Recipient ID |
| notification_type | STRING | NOT NULL | Notification type |
| priority | STRING | NOT NULL | Priority level |
| channel | STRING | NOT NULL | Delivery channel |
| recipient_address | STRING | NOT NULL | Delivery address |
| subject | STRING | NULL | Message subject |
| content | STRING | NOT NULL | Message content |
| template_id | STRING | NULL | Template used |
| template_data | MAP<STRING,STRING> | NULL | Template data |
| scheduled_for | TIMESTAMP | NULL | Schedule time |
| expires_at | TIMESTAMP | NULL | Expiration |
| retry_count | INT | NOT NULL | Retry attempts |
| max_retries | INT | NOT NULL | Max retries |
| status | STRING | NOT NULL | Delivery status |
| sent_at | TIMESTAMP | NULL | Send time |
| failed_at | TIMESTAMP | NULL | Failure time |
| failure_reason | STRING | NULL | Failure reason |
| created_at | TIMESTAMP | NOT NULL | Record creation |

## Relationships

### Primary Foreign Key Relationships
- `users.teachers.school_id` → `users.schools.id`
- `users.students.school_id` → `users.schools.id`
- `sessions.classroom_sessions.teacher_id` → `users.teachers.id`
- `sessions.classroom_sessions.school_id` → `users.schools.id`
- `sessions.student_groups.session_id` → `sessions.classroom_sessions.id`
- `sessions.participants.session_id` → `sessions.classroom_sessions.id`
- `sessions.participants.group_id` → `sessions.student_groups.id`
- `sessions.participants.student_id` → `users.students.id`
- `sessions.transcriptions.session_id` → `sessions.classroom_sessions.id`
- `sessions.transcriptions.group_id` → `sessions.student_groups.id`
- All analytics tables link to sessions via `session_id`
- All compliance tables link to schools via `school_id`

## Compliance Notes

### FERPA Compliance
- All student data is protected with proper access controls
- Audit logging tracks all data access
- Parental consent is tracked and enforced
- Data retention policies are configurable by school

### COPPA Compliance
- Special tracking for students under 13
- Limited data collection for young students
- No behavioral targeting or third-party sharing
- Parental access and control mechanisms

## Performance Considerations

### Partitioning Strategy
- Session-related tables partitioned by `session_id` or `school_id`
- Compliance tables partitioned by `school_id`
- Time-series data (metrics, logs) consider date partitioning

### Indexing Strategy
- Primary keys on all `id` columns
- Foreign key indexes for join performance
- Timestamp indexes for time-based queries
- Status field indexes for filtering

## Data Types Note
All tables use Databricks Delta format for ACID transactions and time travel capabilities.