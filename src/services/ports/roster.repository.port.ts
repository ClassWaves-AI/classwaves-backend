export interface RosterStudent {
  id: string;
  display_name: string;
  school_id: string;
  email: string | null;
  grade_level: string | null;
  status: string | null;
  has_parental_consent: boolean | null;
  consent_date: string | null;
  parent_email: string | null;
  // New consent/age fields used by email + UI transparency
  email_consent?: boolean | null;
  coppa_compliant?: boolean | null;
  teacher_verified_age?: boolean | null;
  data_sharing_consent: boolean | null;
  audio_recording_consent: boolean | null;
  created_at: string | Date | null;
  updated_at: string | Date | null;
}

export interface RosterOverviewMetrics {
  totalStudents: number;
  activeStudents: number;
  pendingConsent: number;
  inactiveStudents: number;
}

export interface RosterRepositoryPort {
  listStudentsBySchool(
    schoolId: string,
    filters: { gradeLevel?: string; status?: string },
    limit: number,
    offset: number
  ): Promise<Array<RosterStudent & { school_name?: string }>>;

  countStudentsBySchool(
    schoolId: string,
    filters: { gradeLevel?: string; status?: string }
  ): Promise<number>;

  findStudentInSchool(studentId: string, schoolId: string): Promise<Pick<RosterStudent, 'id' | 'school_id' | 'status' | 'parent_email'> | null>;
  findStudentByNameInSchool(schoolId: string, displayName: string): Promise<{ id: string } | null>;

  insertStudent(student: {
    id: string;
    display_name: string;
    school_id: string;
    email: string | null;
    grade_level: string | null;
    status: string;
    has_parental_consent: boolean;
    consent_date: string | null;
    parent_email: string | null;
    data_sharing_consent: boolean;
    audio_recording_consent: boolean;
    created_at: string;
    updated_at: string;
  }): Promise<void>;

  updateStudentFields(studentId: string, fields: Record<string, any>): Promise<void>;

  updateStudentNames(studentId: string, names: { given_name?: string | null; family_name?: string | null; preferred_name?: string | null; updated_at?: string }): Promise<void>;

  getStudentWithSchool(studentId: string): Promise<(RosterStudent & { school_name?: string }) | null>;
  getStudentBasicById(studentId: string): Promise<{ id: string; display_name: string; email: string | null } | null>;

  setStudentDeactivated(studentId: string): Promise<void>;

  deleteStudent(studentId: string): Promise<void>;

  countStudentGroupMembership(studentId: string): Promise<number>;

  updateParentalConsent(studentId: string, consentGiven: boolean, consentDateISO: string): Promise<void>;

  getRosterOverviewMetrics(schoolId: string): Promise<RosterOverviewMetrics>;
}
