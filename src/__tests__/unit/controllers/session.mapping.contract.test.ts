import { createSession, getSession } from '../../../controllers/session.controller';
import { databricksService } from '../../../services/databricks.service';
import { getCompositionRoot } from '../../../app/composition-root';

// Mocks
jest.mock('../../../services/databricks.service');

function mockReqRes(params?: any, body?: any, user?: any, school?: any) {
  const req: any = {
    params: params || {},
    body: body || {},
    query: {},
    headers: {},
    ip: '127.0.0.1',
    user: user || { id: 'tch_1', email: 't@example.com', school_id: 'sch_1', role: 'teacher', name: 'Teacher One' },
    school: school || { id: 'sch_1', name: 'Demo School' },
  };
  let statusCode = 200;
  const resBody: any = { json: null };
  const res: any = {
    status: (code: number) => { statusCode = code; return res; },
    json: (payload: any) => { resBody.json = payload; resBody.status = statusCode; return res; }
  };
  return { req, res, out: resBody };
}

describe('Session mapping contract (topic/goal/description) without sockets', () => {
  beforeEach(() => {
    process.env.REDIS_USE_MOCK = '1';
    jest.clearAllMocks();
  });

  it('preserves topic, goal, and description on create and get', async () => {
    const dbrx = databricksService as unknown as any;
    dbrx.generateId = jest.fn()
      .mockReturnValueOnce('sess_abc') // session id
      .mockReturnValueOnce('grp_1')    // group id
      .mockReturnValueOnce('mem_1');   // member id
    dbrx.insert = jest.fn().mockResolvedValue(true);
    dbrx.update = jest.fn().mockResolvedValue(true);

    // Replace repositories to avoid depending on databricksService.queryOne/query
    const cr = getCompositionRoot() as any;
    jest.spyOn(cr, 'getSessionDetailRepository').mockReturnValue({
      getOwnedSessionDetail: jest.fn().mockResolvedValue({
        id: 'sess_abc',
        title: 'Topic T',
        description: 'Description D',
        goal: 'Goal G',
        subject: 'Subject S',
        status: 'created',
        teacher_id: 'tch_1',
        school_id: 'sch_1',
        planned_duration_minutes: 45,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        access_code: 'ABC123'
      })
    });
    jest.spyOn(cr, 'getGroupRepository').mockReturnValue({
      getGroupsBasic: jest.fn().mockResolvedValue([
        { id: 'grp_1', name: 'Group A', leader_id: 'stu_1', is_ready: false, group_number: 1 }
      ]),
      getMembersBySession: jest.fn().mockResolvedValue([
        { group_id: 'grp_1', student_id: 'stu_1', name: 'Leader One' }
      ]),
      insertGroup: jest.fn().mockResolvedValue(undefined),
      insertGroupMember: jest.fn().mockResolvedValue(undefined),
      countTotalStudentsForTeacher: jest.fn()
    });

    // Create payload with distinct goal/description to catch mapping errors
    const payload = {
      topic: 'Topic T',
      goal: 'Goal G',
      subject: 'Subject S',
      description: 'Description D',
      plannedDuration: 45,
      groupPlan: {
        numberOfGroups: 1,
        groupSize: 4,
        groups: [
          { name: 'Group A', leaderId: 'stu_1', memberIds: [] }
        ]
      }
    };

    // Create session via controller directly
    const { req: cReq, res: cRes, out: cOut } = mockReqRes({}, payload);
    await createSession(cReq as any, cRes as any);
    expect(cOut.status).toBe(201);
    expect(cOut.json?.data?.session?.topic).toBe('Topic T');
    expect(cOut.json?.data?.session?.goal).toBe('Goal G');
    expect(cOut.json?.data?.session?.description).toBe('Description D');

    // Get session via controller directly (exercises overlay)
    const { req: gReq, res: gRes, out: gOut } = mockReqRes({ sessionId: 'sess_abc' });
    await getSession(gReq as any, gRes as any);
    expect(gOut.status).toBe(200);
    const session = gOut.json?.data?.session;
    expect(session.topic).toBe('Topic T');
    expect(session.goal).toBe('Goal G');
    expect(session.description).toBe('Description D');
    expect(session.subject).toBe('Subject S');
  });
});
