/**
 * Test Factories
 * 
 * Factory functions for creating test data objects for analytics testing.
 */

import { databricksService } from '../../services/databricks.service';
import { v4 as uuidv4 } from 'uuid';

export interface TestSchoolData {
  id: string;
  name: string;
  domain: string;
  google_workspace_id?: string;
  admin_email: string;
  subscription_tier: string;
  subscription_status: string;
  max_teachers: number;
  current_teachers: number;
  stripe_customer_id?: string;
  subscription_start_date?: Date;
  subscription_end_date?: Date;
  trial_ends_at?: Date;
  ferpa_agreement: boolean;
  coppa_compliant: boolean;
  data_retention_days: number;
  created_at: Date;
  updated_at: Date;
}

export interface TestTeacherData {
  id: string;
  google_id: string;
  email: string;
  name: string;
  picture?: string;
  school_id: string;
  role: string;
  status: string;
  access_level: string;
  max_concurrent_sessions: number;
  current_sessions: number;
  grade?: string;
  subject?: string;
  timezone: string;
  features_enabled?: string;
  last_login?: Date;
  login_count: number;
  total_sessions_created: number;
  created_at: Date;
  updated_at: Date;
}

export interface TestSessionData {
  id: string;
  title: string;
  description?: string;
  status: string;
  scheduled_start?: Date;
  actual_start?: Date;
  actual_end?: Date;
  planned_duration_minutes: number;
  actual_duration_minutes?: number;
  max_students: number;
  target_group_size: number;
  auto_group_enabled: boolean;
  teacher_id: string;
  school_id: string;
  recording_enabled: boolean;
  transcription_enabled: boolean;
  ai_analysis_enabled: boolean;
  ferpa_compliant: boolean;
  coppa_compliant: boolean;
  recording_consent_obtained: boolean;
  data_retention_date?: Date;
  total_groups: number;
  total_students: number;
  created_at: Date;
  updated_at: Date;
  access_code: string;
  end_reason?: string;
}

export interface TestGroupData {
  id: string;
  session_id: string;
  name: string;
  max_size: number;
  leader_id?: string;
  status: string;
}

export interface TestGroupMemberData {
  group_id: string;
  student_id: string;
  joined_at: Date;
  status: string;
}

/**
 * Create a test school
 */
export async function createTestSchool(overrides: Partial<TestSchoolData> = {}): Promise<TestSchoolData> {
  const now = new Date();
  const schoolData: TestSchoolData = {
    id: uuidv4(),
    name: 'Test School',
    domain: 'testschool.edu',
    google_workspace_id: `gws_${uuidv4()}`,
    admin_email: `admin@testschool.edu`,
    subscription_tier: 'premium',
    subscription_status: 'active',
    max_teachers: 50,
    current_teachers: 1,
    stripe_customer_id: `cus_${Math.random().toString(36).substring(2, 15)}`,
    subscription_start_date: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    subscription_end_date: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
    trial_ends_at: undefined,
    ferpa_agreement: true,
    coppa_compliant: true,
    data_retention_days: 2555, // 7 years in days
    created_at: now,
    updated_at: now,
    ...overrides
  };

  try {
    await databricksService.insert('schools', schoolData);
    return schoolData;
  } catch (error) {
    // If insert fails, might be a duplicate - just return the data
    console.warn('School insert failed, continuing with test data:', error);
    return schoolData;
  }
}

/**
 * Create a test teacher
 */
export async function createTestTeacher(overrides: Partial<TestTeacherData> = {}): Promise<TestTeacherData> {
  const now = new Date();
  const teacherData: TestTeacherData = {
    id: uuidv4(),
    google_id: `google_${uuidv4()}`,
    email: `teacher${Math.random().toString(36).substring(7)}@test.edu`,
    name: 'Test Teacher',
    picture: `https://lh3.googleusercontent.com/test-${uuidv4()}`,
    school_id: uuidv4(),
    role: 'teacher',
    status: 'active',
    access_level: 'standard',
    max_concurrent_sessions: 5,
    current_sessions: 0,
    grade: 'K-5',
    subject: 'General',
    timezone: 'America/New_York',
    features_enabled: 'ai_analysis,recording,transcription',
    last_login: new Date(now.getTime() - 24 * 60 * 60 * 1000), // 1 day ago
    login_count: 5,
    total_sessions_created: 12,
    created_at: now,
    updated_at: now,
    ...overrides
  };

  try {
    await databricksService.insert('teachers', teacherData);
    return teacherData;
  } catch (error) {
    console.warn('Teacher insert failed, continuing with test data:', error);
    return teacherData;
  }
}

/**
 * Create a test session
 */
export async function createTestSession(overrides: Partial<TestSessionData> = {}): Promise<TestSessionData> {
  const now = new Date();
  const sessionData: TestSessionData = {
    id: uuidv4(),
    title: 'Test Session',
    description: 'Integration test session for automated testing',
    status: 'created',
    scheduled_start: new Date(now.getTime() + 60 * 60 * 1000), // 1 hour from now
    actual_start: undefined,
    actual_end: undefined,
    planned_duration_minutes: 50,
    actual_duration_minutes: undefined,
    max_students: 30,
    target_group_size: 4,
    auto_group_enabled: true,
    teacher_id: uuidv4(),
    school_id: uuidv4(),
    recording_enabled: false, // Default to false for test privacy
    transcription_enabled: true,
    ai_analysis_enabled: true,
    ferpa_compliant: true,
    coppa_compliant: true,
    recording_consent_obtained: false, // Since recording disabled
    data_retention_date: new Date(now.getTime() + (2555 * 24 * 60 * 60 * 1000)), // 7 years
    total_groups: 0,
    total_students: 0,
    created_at: now,
    updated_at: now,
    access_code: Math.random().toString(36).substring(2, 8).toUpperCase(),
    end_reason: undefined,
    ...overrides
  };

  try {
    await databricksService.insert('classroom_sessions', sessionData);
    return sessionData;
  } catch (error) {
    console.warn('Session insert failed, continuing with test data:', error);
    return sessionData;
  }
}

/**
 * Create a test group
 */
export async function createTestGroup(overrides: Partial<TestGroupData> = {}): Promise<TestGroupData> {
  const groupData: TestGroupData = {
    id: uuidv4(),
    session_id: uuidv4(),
    name: `Group ${Math.random().toString(36).substring(2, 4).toUpperCase()}`,
    max_size: 4,
    leader_id: uuidv4(),
    status: 'active',
    ...overrides
  };

  try {
    await databricksService.insert('session_groups', groupData);
    return groupData;
  } catch (error) {
    console.warn('Group insert failed, continuing with test data:', error);
    return groupData;
  }
}

/**
 * Create a test group member
 */
export async function createTestGroupMember(overrides: Partial<TestGroupMemberData> = {}): Promise<TestGroupMemberData> {
  const memberData: TestGroupMemberData = {
    group_id: uuidv4(),
    student_id: uuidv4(),
    joined_at: new Date(),
    status: 'active',
    ...overrides
  };

  try {
    await databricksService.insert('session_group_members', memberData);
    return memberData;
  } catch (error) {
    console.warn('Group member insert failed, continuing with test data:', error);
    return memberData;
  }
}

/**
 * Create a complete test session with groups and members
 */
export async function createTestSessionWithGroups(options: {
  sessionOverrides?: Partial<TestSessionData>;
  groupCount?: number;
  membersPerGroup?: number;
} = {}): Promise<{
  session: TestSessionData;
  groups: TestGroupData[];
  members: TestGroupMemberData[];
}> {
  const { sessionOverrides = {}, groupCount = 3, membersPerGroup = 3 } = options;

  // Create school and teacher first
  const school = await createTestSchool();
  const teacher = await createTestTeacher({ school_id: school.id });

  // Create session
  const session = await createTestSession({
    teacher_id: teacher.id,
    school_id: school.id,
    ...sessionOverrides
  });

  // Create groups
  const groups: TestGroupData[] = [];
  const members: TestGroupMemberData[] = [];

  for (let i = 0; i < groupCount; i++) {
    const group = await createTestGroup({
      session_id: session.id,
      name: `Group ${String.fromCharCode(65 + i)}`, // Group A, B, C...
      max_size: membersPerGroup + 1, // +1 for leader
    });
    groups.push(group);

    // Create members for this group
    for (let j = 0; j < membersPerGroup; j++) {
      const member = await createTestGroupMember({
        group_id: group.id,
        student_id: uuidv4(),
        joined_at: new Date(Date.now() + j * 1000) // Stagger join times
      });
      members.push(member);
    }
  }

  return { session, groups, members };
}

/**
 * Clean up test data
 */
export async function cleanupTestData(sessionIds: string[] = []): Promise<void> {
  try {
    // Clean up in reverse dependency order
    for (const sessionId of sessionIds) {
      await databricksService.query('DELETE FROM session_group_members WHERE group_id IN (SELECT id FROM session_groups WHERE session_id = ?)', [sessionId]);
      await databricksService.query('DELETE FROM session_groups WHERE session_id = ?', [sessionId]);
      await databricksService.query('DELETE FROM session_analytics WHERE session_id = ?', [sessionId]);
      await databricksService.query('DELETE FROM classroom_sessions WHERE id = ?', [sessionId]);
    }
  } catch (error) {
    console.warn('Error cleaning up test data:', error);
  }
}

/**
 * Create mock analytics data for testing
 */
export function createMockAnalyticsData(sessionId: string) {
  return {
    sessionId,
    computedAt: new Date().toISOString(),
    membershipSummary: {
      totalConfiguredMembers: 12,
      totalActualMembers: 9,
      groupsWithLeadersPresent: 3,
      groupsAtFullCapacity: 2,
      averageMembershipAdherence: 0.75,
      membershipFormationTime: {
        avgFormationTime: 45000, // 45 seconds
        fastestGroup: {
          name: 'Group A',
          first_member_joined: '2024-01-01T10:05:00Z',
          last_member_joined: '2024-01-01T10:05:30Z'
        }
      }
    },
    engagementMetrics: {
      totalParticipants: 9,
      activeGroups: 3,
      averageEngagement: 0.82,
      participationRate: 0.78
    },
    timelineAnalysis: {
      sessionDuration: 60, // minutes
      groupFormationTime: 8, // minutes
      activeParticipationTime: 52, // minutes
      keyMilestones: [
        {
          timestamp: '2024-01-01T10:00:00Z',
          event: 'Session Started',
          description: 'Teacher began the session'
        },
        {
          timestamp: '2024-01-01T10:05:30Z',
          event: 'All Groups Ready',
          description: 'All groups formed and marked as ready'
        }
      ]
    },
    groupPerformance: [
      {
        groupId: 'group-1',
        groupName: 'Group A',
        memberCount: 3,
        engagementScore: 0.85,
        participationRate: 0.80,
        readyTime: '2024-01-01T10:05:30Z'
      }
    ]
  };
}
