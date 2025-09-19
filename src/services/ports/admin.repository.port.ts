export interface SchoolSummary {
  id: string;
  name: string;
  domain: string;
  admin_email?: string;
  subscription_tier?: string;
  subscription_status?: string;
  ferpa_agreement?: boolean;
  coppa_compliant?: boolean;
}

export interface TeacherSummary {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  school_id: string;
  role: string;
  status: string | null;
  access_level?: string | null;
  max_concurrent_sessions?: number | null;
  current_sessions?: number | null;
  grade?: string | null;
  subject?: string | null;
  timezone?: string | null;
  login_count?: number | null;
  total_sessions_created?: number | null;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
  school_name?: string;
  school_domain?: string;
}

export interface AdminRepositoryPort {
  listSchools(limit: number, offset: number): Promise<SchoolSummary[]>;
  countSchools(): Promise<number>;
  findSchoolByDomain(domain: string): Promise<{ id: string } | null>;
  findTeacherByEmail?(email: string): Promise<{ id: string; school_id: string } | null>;
  insertSchool(school: {
    id: string;
    name: string;
    domain: string;
    admin_email: string;
    subscription_tier: string;
    subscription_status: string;
    max_teachers: number;
    current_teachers: number;
    subscription_start_date: string;
    subscription_end_date: string | null;
    trial_ends_at: string | null;
    ferpa_agreement: boolean;
    coppa_compliant: boolean;
    data_retention_days: number;
    created_at: string;
    updated_at: string;
  }): Promise<void>;
  getSchoolSummaryById(schoolId: string): Promise<SchoolSummary | null>;
  updateSchoolById(schoolId: string, fields: Record<string, any>): Promise<void>;

  listTeachers(filter: { schoolId?: string }, limit: number, offset: number): Promise<TeacherSummary[]>;
  countTeachers(filter: { schoolId?: string }): Promise<number>;
  getTeacherSummaryById(teacherId: string): Promise<TeacherSummary | null>;
  updateTeacherById(teacherId: string, fields: Record<string, any>): Promise<void>;
  insertTeacher?(teacher: {
    id: string;
    email: string;
    name: string;
    school_id: string;
    role: string;
    status: string;
    access_level?: string | null;
    created_at: string;
    updated_at: string;
  }): Promise<void>;

  // Districts
  listDistricts(filter: { state?: string; q?: string; isActive?: boolean }, limit: number, offset: number): Promise<{
    id: string; name: string; state?: string | null; region?: string | null; superintendent_name?: string | null; contact_email?: string | null; contact_phone?: string | null; website?: string | null; subscription_tier?: string | null; is_active?: boolean | null; created_at?: string | Date | null; updated_at?: string | Date | null;
  }[]>;
  countDistricts(filter: { state?: string; q?: string; isActive?: boolean }): Promise<number>;
  getDistrictById(id: string): Promise<{
    id: string; name: string; state?: string | null; region?: string | null; superintendent_name?: string | null; contact_email?: string | null; contact_phone?: string | null; website?: string | null; subscription_tier?: string | null; is_active?: boolean | null; created_at?: string | Date | null; updated_at?: string | Date | null;
  } | null>;
  insertDistrict(district: {
    id: string; name: string; state: string; region?: string | null; superintendent_name?: string | null; contact_email?: string | null; contact_phone?: string | null; website?: string | null; subscription_tier?: string | null; is_active?: boolean | null; created_at: string; updated_at: string;
  }): Promise<void>;
  updateDistrictById(id: string, fields: Record<string, any>): Promise<void>;
}
