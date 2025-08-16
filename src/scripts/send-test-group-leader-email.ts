import dotenv from 'dotenv';
import { databricksService } from '../services/databricks.service';
import { emailService } from '../services/email.service';
import { databricksConfig } from '../config/databricks.config';
import type { EmailRecipient, SessionEmailData } from '@classwaves/shared';

dotenv.config();

function getArg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  if (arg) return arg.slice(prefix.length);
  return fallback;
}

async function ensureStudentForEmail(email: string, displayName: string): Promise<{ id: string; name: string }> {
  // If Databricks token is missing, fabricate a student in dev mode
  const tokenMissing = !databricksConfig.token;
  if (tokenMissing) {
    console.warn('⚠️ Databricks token not found. Running in dev skip mode: fabricating student for email test.');
    return { id: `dev_${Date.now()}`, name: displayName };
  }

  await databricksService.connect();

  // Try to find existing student by email
  const existing = await databricksService.queryOne<any>(
    `SELECT id, display_name, email, email_consent, coppa_compliant
     FROM ${databricksConfig.catalog}.users.students
     WHERE email = ?
     LIMIT 1`,
    [email]
  );

  if (existing && existing.id) {
    const needsUpdate = existing.email_consent !== true || existing.coppa_compliant !== true;
    if (needsUpdate) {
      await databricksService.update('students', existing.id, {
        email_consent: true,
        coppa_compliant: true,
        teacher_verified_age: true,
      });
    }
    return { id: existing.id, name: existing.display_name || displayName };
  }

  // Create a minimal compliant student record
  const studentId = databricksService.generateId();
  const now = new Date();
  await databricksService.insert('students', {
    id: studentId,
    display_name: displayName,
    email,
    status: 'active',
    email_consent: true,
    coppa_compliant: true,
    teacher_verified_age: true,
    created_at: now,
    updated_at: now,
  });

  return { id: studentId, name: displayName };
}

async function main() {
  try {
    const targetEmail = getArg('email', process.env.TEST_EMAIL) || 'rob@classwaves.ai';
    const studentName = getArg('name', 'Rob Test') || 'Rob Test';
    const sessionTitle = getArg('title', 'Test Session - Group Leader Invite') || 'Test Session - Group Leader Invite';
    const schoolName = getArg('school', 'ClassWaves QA') || 'ClassWaves QA';
    const teacherName = getArg('teacher', 'QA Teacher') || 'QA Teacher';
    const accessCode = getArg('code', 'TST123') || 'TST123';
    const joinBase = process.env.STUDENT_APP_URL || 'http://localhost:3003';

    if (!process.env.GMAIL_USER_EMAIL || !process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
      console.error('❌ Missing Gmail OAuth2 env vars. Required: GMAIL_USER_EMAIL, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN');
      process.exit(2);
    }

    const { id: studentId, name } = await ensureStudentForEmail(targetEmail, studentName);

    // Initialize email service (Gmail OAuth2)
    process.env.EMAIL_DEV_MODE = process.env.EMAIL_DEV_MODE || 'true';
    await emailService.initialize();

    const recipient: EmailRecipient = {
      email: targetEmail,
      name,
      role: 'group_leader',
      studentId,
      groupId: 'test-group',
      groupName: 'Test Group',
    };

    const sessionData: SessionEmailData = {
      sessionId: 'test-session',
      sessionTitle,
      sessionDescription: 'This is a test of the group leader invitation email.',
      accessCode,
      teacherName,
      schoolName,
      scheduledStart: new Date(),
      joinUrl: `${joinBase}/join/${accessCode}`,
    };

    console.log(`📧 Sending test group leader email to ${targetEmail} (studentId=${studentId})...`);
    const results = await emailService.sendSessionInvitation([recipient], sessionData);
    console.log('📊 Results:', results);

    if (results.failed.length > 0) {
      console.error('❌ Some emails failed to send:', results.failed);
      process.exit(1);
    }

    console.log('✅ Test email sent successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error sending test email:', error);
    process.exit(1);
  }
}

main();


