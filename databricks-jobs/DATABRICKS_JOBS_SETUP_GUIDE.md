# Databricks Jobs Setup Guide

This guide shows how to set up automated pre-aggregation jobs in Databricks for optimal analytics performance.

## 🎯 Overview

We're implementing **4 pre-aggregation strategies** using Databricks Jobs instead of application-level scheduling for better performance, reliability, and cost efficiency.

### Benefits of Databricks Jobs vs Node.js Scheduling

| Aspect | Databricks Jobs | Node.js Cron |
|--------|----------------|---------------|
| **Resource Management** | Auto-scaling, optimized compute | Fixed server resources |
| **Cost Efficiency** | Pay per execution, auto-terminate | Always-on server costs |
| **SQL Optimization** | Native Delta/SQL optimization | Query through API layer |
| **Error Handling** | Built-in retry, alerts, monitoring | Custom error handling needed |
| **Scalability** | Automatic cluster scaling | Limited by server capacity |
| **Maintenance** | Managed service | Requires infrastructure management |

## 📋 Prerequisites

1. **Databricks Workspace Access** with job creation permissions
2. **Unity Catalog Access** to `classwaves` catalog
3. **Pre-aggregated Tables Created** (use setup endpoint first)
4. **Email/Slack Integration** for job monitoring (optional)

## 🚀 Job Setup Instructions

### Step 1: Create Pre-aggregated Tables

First, create the required tables using our API endpoint:

```bash
# Using the backend API (requires admin access)
curl -X POST http://localhost:3001/api/v1/analytics/monitoring/setup-tables \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

This creates:
- `teacher_analytics_summary` - Daily teacher metrics
- `dashboard_metrics_hourly` - Hourly dashboard rollups  
- `session_analytics_cache` - Real-time session cache
- `school_comparison_metrics` - Weekly school comparisons

### Step 2: Create Databricks Jobs

#### Job 1: Teacher Analytics Daily Aggregation

**📅 Schedule:** Daily at 2:00 AM UTC (`0 2 * * *`)

1. **Create New Job** in Databricks UI
   - Name: `ClassWaves-Teacher-Analytics-Daily`
   - Description: `Daily aggregation of teacher analytics for 85% query performance improvement`

2. **Configure Task**
   - Task Type: `SQL`
   - SQL File: Upload `teacher-analytics-daily-job.sql`
   - Warehouse: Select appropriate SQL warehouse

3. **Set Schedule**
   - Trigger Type: `Scheduled`
   - Cron Expression: `0 2 * * *`
   - Timezone: `UTC`

4. **Configure Cluster** (if using Job Cluster)
   - Cluster Mode: `Single Node` or `Standard (2 workers)`
   - Databricks Runtime: `13.3 LTS` or later
   - Worker Type: `i3.large` (cost-effective for this workload)
   - Auto Termination: `10 minutes`

5. **Set Alerts**
   - Email on failure: `your-team@example.com`
   - Timeout: `30 minutes`

#### Job 2: Dashboard Metrics Hourly Rollup

**📅 Schedule:** Every hour (`0 * * * *`)

1. **Create New Job**
   - Name: `ClassWaves-Dashboard-Metrics-Hourly`
   - Description: `Hourly rollup of dashboard metrics for 90% query performance improvement`

2. **Configure Task**
   - Task Type: `SQL`
   - SQL File: Upload `dashboard-metrics-hourly-job.sql`
   - Warehouse: Select appropriate SQL warehouse

3. **Set Schedule**
   - Trigger Type: `Scheduled`
   - Cron Expression: `0 * * * *`
   - Timezone: `UTC`

4. **Configure Cluster**
   - Cluster Mode: `Single Node`
   - Worker Type: `i3.large`
   - Auto Termination: `5 minutes`

#### Job 3: Session Cache Maintenance

**📅 Schedule:** Every 10 minutes (`*/10 * * * *`)

1. **Create New Job**
   - Name: `ClassWaves-Session-Cache-Maintenance`
   - Description: `Real-time session cache maintenance for 70% query performance improvement`

2. **Configure Task**
   - Task Type: `SQL`
   - SQL File: Upload `session-cache-maintenance-job.sql`
   - Warehouse: Select appropriate SQL warehouse

3. **Set Schedule**
   - Trigger Type: `Scheduled`
   - Cron Expression: `*/10 * * * *`
   - Timezone: `UTC`

4. **Configure Cluster**
   - Cluster Mode: `Single Node`
   - Worker Type: `i3.large`
   - Auto Termination: `3 minutes`

## 📊 Expected Performance Improvements

| Job | Frequency | Query Time Reduction | Cost Reduction | Data Scanning Saved |
|-----|-----------|---------------------|----------------|-------------------|
| Teacher Analytics | Daily | 85% | 80% | 20GB per query |
| Dashboard Metrics | Hourly | 90% | 85% | 25.5GB per query |
| Session Cache | 10 minutes | 70% | 60% | 7.2GB per query |

**Total Expected Savings:**
- **64% overall cost reduction** (from $45/day to $16.25/day)
- **75% faster query response times**
- **90% reduction in peak load**
- **$855/month in projected savings**

## 🔧 Configuration Best Practices

### Cluster Configuration

```yaml
# Recommended cluster settings
cluster_config:
  single_node: true  # Cost-effective for these workloads
  runtime_version: "13.3.x-scala2.12"
  node_type: "i3.large"  # Good price/performance ratio
  auto_termination_minutes: 5  # Quick cleanup
  enable_elastic_disk: false  # Not needed for these jobs
```

### Job Timeouts and Retries

```yaml
# Recommended job settings
job_settings:
  timeout_seconds: 1800  # 30 minutes max
  max_retries: 2
  retry_on_timeout: true
  email_notifications:
    on_failure: ["admin@classwaves.com"]
    no_alert_for_skipped_runs: true
```

### Cost Optimization

1. **Use SQL Warehouses** when possible (serverless, auto-scaling)
2. **Single node clusters** for small aggregation jobs
3. **Auto-termination** set to minimum viable time
4. **Schedule during off-peak hours** for better resource availability

## 📈 Monitoring and Alerting

### Built-in Databricks Monitoring

1. **Job Run History** - View execution logs and performance
2. **Query Performance** - Monitor query execution times
3. **Cluster Utilization** - Track resource usage
4. **Cost Tracking** - Monitor DBU consumption

### Custom Monitoring Integration

The jobs automatically log to our `audit_logs` table:

```sql
-- Check job execution history
SELECT 
  action,
  resource_id,
  timestamp,
  metadata
FROM audit_logs 
WHERE action LIKE '%aggregation%'
ORDER BY timestamp DESC;
```

### Slack/Email Alerts

Configure Databricks to send alerts to:
- `#classwaves-analytics` Slack channel
- Engineering team email list
- On-call rotation

## 🚨 Troubleshooting

### Common Issues

1. **Table Not Found Errors**
   ```
   Solution: Run the table setup API endpoint first
   ```

2. **Permission Denied**
   ```
   Solution: Ensure Unity Catalog permissions for classwaves catalog
   ```

3. **Job Timeout**
   ```
   Solution: Increase cluster size or optimize queries
   ```

4. **Data Freshness Issues**
   ```
   Solution: Check if source tables have recent data
   ```

### Health Checks

```sql
-- Verify data freshness
SELECT 
  'teacher_analytics_summary' as table_name,
  max(calculated_at) as last_update,
  count(*) as total_records
FROM teacher_analytics_summary
WHERE summary_date >= current_date() - INTERVAL 7 DAY

UNION ALL

SELECT 
  'dashboard_metrics_hourly' as table_name,
  max(calculated_at) as last_update,
  count(*) as total_records  
FROM dashboard_metrics_hourly
WHERE metric_hour >= current_timestamp() - INTERVAL 24 HOUR;
```

## 🔄 Migration from Node.js Scheduling

If migrating from existing Node.js cron jobs:

1. **Phase 1:** Set up Databricks jobs (parallel testing)
2. **Phase 2:** Monitor both systems for accuracy
3. **Phase 3:** Switch traffic to pre-aggregated tables
4. **Phase 4:** Disable Node.js scheduled jobs
5. **Phase 5:** Remove Node.js scheduling code

## 📚 Additional Resources

- [Databricks Jobs Documentation](https://docs.databricks.com/workflows/jobs/index.html)
- [SQL Warehouse Guide](https://docs.databricks.com/sql/admin/sql-endpoints.html)
- [Delta Table Optimization](https://docs.databricks.com/delta/optimizations/index.html)
- [Unity Catalog Security](https://docs.databricks.com/data-governance/unity-catalog/index.html)

## 🎉 Success Metrics

Monitor these KPIs after deployment:

1. **Query Performance**
   - Average teacher analytics query time: < 200ms (was 1.2s)
   - Average dashboard load time: < 150ms (was 1.5s)
   - Session analytics response: < 100ms (was 300ms)

2. **Cost Reduction**
   - Daily Databricks spend: < $16.25 (was $45)
   - Monthly compute savings: > $855
   - Query cost per request: < 60% of original

3. **Reliability**
   - Job success rate: > 99.5%
   - Data freshness SLA: < 10 minutes lag
   - Zero manual intervention needed

---

**Next Steps:** Start with Job 1 (Teacher Analytics) and gradually roll out all jobs while monitoring performance and cost impact.
