import { Request, Response } from 'express';
import { databricksService } from '../services/databricks.service';
import { AuthRequest } from '../types/auth.types';
import { createStudentGroupData } from '../utils/schema-defaults';
import { generateGroupAccessToken } from '../utils/jwt.utils';

export async function getSessionGroups(req: Request, res: Response): Promise<Response> {
  try {
    const authReq = req as AuthRequest;
    const { sessionId } = req.params;
    
    if (!authReq.user) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'User not authenticated',
      });
    }
    
    const session = await databricksService.queryOne(
      `SELECT * FROM classwaves.sessions.classroom_sessions WHERE id = ? AND teacher_id = ?`,
      [sessionId, authReq.user.id]
    );
    
    if (!session) {
      return res.status(404).json({
        error: 'SESSION_NOT_FOUND',
        message: 'Session not found or access denied',
      });
    }
    
    const groups = await databricksService.query(
      `SELECT id, session_id, name, group_number, status, max_size, current_size, student_ids,
              auto_managed, is_ready, leader_id, created_at, updated_at
       FROM classwaves.sessions.student_groups
       WHERE session_id = ?
       ORDER BY group_number`,
      [sessionId]
    );
    
    return res.json({
      success: true,
      groups: groups.map(group => ({
        id: group.id,
        name: group.name,
        groupNumber: group.group_number,
        status: group.status,
        maxMembers: group.max_size,
        currentMembers: group.current_size || 0,
        studentIds: JSON.parse(group.student_ids || '[]'),
        autoManaged: group.auto_managed,
        isReady: group.is_ready,
        leaderId: group.leader_id,
        createdAt: group.created_at,
      })),
    });
  } catch (error) {
    console.error('Get groups error:', error);
    return res.status(500).json({
      error: 'GROUPS_FETCH_FAILED',
      message: 'Failed to fetch groups',
    });
  }
}

export async function createGroup(req: Request, res: Response): Promise<Response> {
  try {
    const authReq = req as AuthRequest;
    const { sessionId } = req.params;
    const { name, maxMembers = 4, leaderId, studentIds = [] } = req.body || {};
    
    if (!authReq.user) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'User not authenticated' });
    }
    
    const session = await databricksService.queryOne(
      `SELECT * FROM classwaves.sessions.classroom_sessions 
       WHERE id = ? AND teacher_id = ? AND status IN ('created', 'active')`,
      [sessionId, authReq.user.id]
    );
    
    if (!session) {
      return res.status(404).json({ error: 'SESSION_NOT_FOUND', message: 'Session not found, access denied, or session already ended' });
    }
    
    if (leaderId) {
      const leader = await databricksService.queryOne(
        `SELECT id FROM classwaves.users.students WHERE id = ? AND school_id = ?`,
        [leaderId, authReq.user.school_id]
      );
      
      if (!leader) {
        return res.status(400).json({ error: 'INVALID_LEADER', message: 'Selected leader is not a valid student in this school.' });
      }
      if (!studentIds.includes(leaderId)) {
          studentIds.push(leaderId);
      }
    }
    
    const groupCount = await databricksService.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM classwaves.sessions.student_groups WHERE session_id = ?`,
      [sessionId]
    );
    
    const groupNumber = (groupCount?.count || 0) + 1;
    const groupId = databricksService.generateId();
    
    const groupData = createStudentGroupData({
      id: groupId,
      session_id: sessionId,
      name: name || `Group ${groupNumber}`,
      group_number: groupNumber,
      max_size: maxMembers,
      current_size: studentIds.length,
      student_ids: JSON.stringify(studentIds),
      auto_managed: false,
      is_ready: false,
      leader_id: leaderId || null,
    });
    
    await databricksService.insert('student_groups', groupData);
    
    const group = await databricksService.queryOne(
      `SELECT * FROM classwaves.sessions.student_groups WHERE id = ?`,
      [groupId]
    );
    
    // Generate group access token
    const groupAccessToken = generateGroupAccessToken(groupId, sessionId);
    
    // Return token with group data
    return res.status(201).json({
      success: true,
      data: {
        group: {
          id: groupId,
          name: group.name,
          groupNumber: group.group_number,
          status: group.status,
          maxMembers: group.max_size,
          currentMembers: group.current_size,
          studentIds: JSON.parse(group.student_ids || '[]'),
          autoManaged: group.auto_managed,
          isReady: group.is_ready,
          leaderId: group.leader_id,
        },
        groupAccessToken,
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
      }
    });
  } catch (error) {
    console.error('Create group error:', error);
    return res.status(500).json({ error: 'GROUP_CREATION_FAILED', message: 'Failed to create group' });
  }
}

export async function updateGroup(req: Request, res: Response): Promise<Response> {
  try {
    const authReq = req as AuthRequest;
    const { sessionId, groupId } = req.params;
    const { name, maxMembers, status, isReady, studentIds } = req.body;
    
    if (!authReq.user) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'User not authenticated' });
    }
    
    const group = await databricksService.queryOne(
      `SELECT g.*, s.teacher_id 
       FROM classwaves.sessions.student_groups g
       JOIN classwaves.sessions.classroom_sessions s ON g.session_id = s.id
       WHERE g.id = ? AND g.session_id = ? AND s.teacher_id = ?`,
      [groupId, sessionId, authReq.user.id]
    );
    
    if (!group) {
      return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'Group not found or access denied' });
    }
    
    const fieldsToUpdate: Record<string, any> = {};
    if (name !== undefined) fieldsToUpdate.name = name;
    if (maxMembers !== undefined) fieldsToUpdate.max_size = maxMembers;
    if (status !== undefined) fieldsToUpdate.status = status;
    if (isReady !== undefined) fieldsToUpdate.is_ready = isReady;
    if (studentIds !== undefined) {
        fieldsToUpdate.student_ids = JSON.stringify(studentIds);
        fieldsToUpdate.current_size = studentIds.length;
    }
    
    if (Object.keys(fieldsToUpdate).length === 0) {
      return res.status(400).json({ error: 'NO_UPDATES', message: 'No valid fields to update' });
    }
    
    await databricksService.update('student_groups', groupId, fieldsToUpdate);
    
    const updatedGroup = await databricksService.queryOne(
      `SELECT * FROM classwaves.sessions.student_groups WHERE id = ?`,
      [groupId]
    );
    
    return res.json({
      success: true,
      group: {
        id: updatedGroup.id,
        name: updatedGroup.name,
        status: updatedGroup.status,
        maxMembers: updatedGroup.max_size,
        currentMembers: updatedGroup.current_size,
        studentIds: JSON.parse(updatedGroup.student_ids || '[]'),
        isReady: updatedGroup.is_ready,
        leaderId: updatedGroup.leader_id,
      },
    });
  } catch (error) {
    console.error('Update group error:', error);
    return res.status(500).json({ error: 'GROUP_UPDATE_FAILED', message: 'Failed to update group' });
  }
}

export async function deleteGroup(req: Request, res: Response): Promise<Response> {
  try {
    const authReq = req as AuthRequest;
    const { sessionId, groupId } = req.params;
    
    if (!authReq.user) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'User not authenticated' });
    }
    
    const group = await databricksService.queryOne(
      `SELECT g.*, s.teacher_id, s.status as session_status
       FROM classwaves.sessions.student_groups g
       JOIN classwaves.sessions.classroom_sessions s ON g.session_id = s.id
       WHERE g.id = ? AND g.session_id = ? AND s.teacher_id = ?`,
      [groupId, sessionId, authReq.user.id]
    );
    
    if (!group) {
      return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'Group not found or access denied' });
    }
    
    if (group.session_status === 'active') {
      return res.status(400).json({ error: 'SESSION_ACTIVE', message: 'Cannot delete groups from an active session' });
    }
    
    await databricksService.delete('student_groups', groupId);
    
    await databricksService.recordAuditLog({
      actorId: authReq.user.id,
      actorType: 'teacher',
      eventType: 'group_deleted',
      resourceId: groupId,
      description: `Teacher ${authReq.user.email} deleted group "${group.name}"`,
    });
    
    return res.json({ success: true, message: 'Group deleted successfully' });
  } catch (error) {
    console.error('Delete group error:', error);
    return res.status(500).json({ error: 'GROUP_DELETE_FAILED', message: 'Failed to delete group' });
  }
}

export async function assignGroupLeader(req: Request, res: Response): Promise<Response> {
  try {
    const authReq = req as AuthRequest;
    const { sessionId, groupId } = req.params;
    const { leaderId } = req.body;
    
    if (!authReq.user) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'User not authenticated' });
    }
    
    const group = await databricksService.queryOne(
      `SELECT g.student_ids, s.teacher_id
       FROM classwaves.sessions.student_groups g
       JOIN classwaves.sessions.classroom_sessions s ON g.session_id = s.id
       WHERE g.id = ? AND g.session_id = ? AND s.teacher_id = ?`,
      [groupId, sessionId, authReq.user.id]
    );
    
    if (!group) {
      return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'Group not found or access denied' });
    }
    
    const studentIds = JSON.parse(group.student_ids || '[]');
    if (!studentIds.includes(leaderId)) {
      return res.status(400).json({
        error: 'INVALID_LEADER',
        message: 'Selected leader is not a member of this group.',
      });
    }
    
    await databricksService.update('student_groups', groupId, {
      leader_id: leaderId,
      updated_at: new Date(),
    });
    
    return res.json({
      success: true,
      message: 'Group leader assigned successfully',
      data: { groupId, leaderId },
    });
  } catch (error) {
    console.error('Assign group leader error:', error);
    return res.status(500).json({ error: 'LEADER_ASSIGNMENT_FAILED', message: 'Failed to assign group leader' });
  }
}
