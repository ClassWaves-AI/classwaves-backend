export interface GroupRepositoryPort {
  countReady(sessionId: string): Promise<number>;
  countTotal(sessionId: string): Promise<number>;
  getGroupsBasic(sessionId: string): Promise<Array<{
    id: string;
    name: string | null;
    leader_id: string | null;
    is_ready: boolean | null;
    group_number: number | null;
  }>>;
  getMembersBySession(sessionId: string): Promise<Array<{
    group_id: string;
    student_id: string;
    name: string | null;
  }>>;
  findLeaderAssignmentByEmail(sessionId: string, email: string): Promise<Array<{ group_id: string; group_name: string; leader_id: string; leader_name: string; leader_email: string }>>;
  findLeaderAssignmentByName(sessionId: string, displayName: string): Promise<Array<{ group_id: string; group_name: string; leader_id: string; leader_name: string; leader_email: string | null }>>;
  insertGroup(data: Record<string, any>): Promise<void>;
  insertGroupMember(data: Record<string, any>): Promise<void>;
  updateGroupFields(groupId: string, fields: Record<string, any>): Promise<void>;
  countTotalStudentsForTeacher(teacherId: string): Promise<number>;
  getGroupSessionAndNameById(groupId: string): Promise<{ session_id: string; name: string | null } | null>;
  groupExistsInSession(sessionId: string, groupId: string): Promise<boolean>;
}
