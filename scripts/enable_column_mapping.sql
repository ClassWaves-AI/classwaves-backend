-- SQL SCRIPT TO ENABLE COLUMN MAPPING ON DATABRICKS TABLES
-- Version: 1.0
-- Author: ClassWaves Meta-Expert
-- Date: 2025-08-04

-- USE CATALOG classwaves;
-- USE SCHEMA sessions;

-- Enable Column Mapping on tables where we need to drop columns.
-- This is a prerequisite for dropping columns in Delta Lake.

ALTER TABLE classwaves.sessions.student_groups SET TBLPROPERTIES ('delta.columnMapping.mode' = 'name');

ALTER TABLE classwaves.sessions.classroom_sessions SET TBLPROPERTIES ('delta.columnMapping.mode' = 'name');

ALTER TABLE classwaves.sessions.transcriptions SET TBLPROPERTIES ('delta.columnMapping.mode' = 'name');

SELECT 'Column mapping enabled successfully.' AS status;

