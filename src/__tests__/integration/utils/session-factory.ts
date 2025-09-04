import request from 'supertest';
import type express from 'express';
import axios, { AxiosResponse } from 'axios';
import { markAllGroupsReady } from './group-readiness';

export async function createSessionWithSupertest(
  app: express.Application,
  authToken: string,
  sessionData: any
): Promise<{ sessionId: string; response: any }> {
  const response = await request(app)
    .post('/api/v1/sessions')
    .set('Authorization', `Bearer ${authToken}`)
    .send(sessionData)
    .expect(201);
  const sessionId = response.body.data.session.id as string;
  return { sessionId, response };
}

export async function startSessionWithSupertest(
  app: express.Application,
  authToken: string,
  sessionId: string
): Promise<any> {
  await markAllGroupsReady(sessionId);
  const startResponse = await request(app)
    .post(`/api/v1/sessions/${sessionId}/start`)
    .set('Authorization', `Bearer ${authToken}`)
    .expect(200);
  return startResponse;
}

export async function createSessionWithAxios(
  baseUrl: string,
  authToken: string,
  sessionData: any
): Promise<{ sessionId: string; response: AxiosResponse } > {
  const response = await axios.post(`${baseUrl}/api/v1/sessions`, sessionData, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    validateStatus: () => true
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Session create failed: ${response.status}`);
  }
  const sessionId = response.data.data.session.id as string;
  return { sessionId, response };
}

export async function startSessionWithAxios(
  baseUrl: string,
  authToken: string,
  sessionId: string
): Promise<AxiosResponse> {
  await markAllGroupsReady(sessionId);
  const resp = await axios.post(`${baseUrl}/api/v1/sessions/${sessionId}/start`, null, {
    headers: { Authorization: `Bearer ${authToken}` },
    validateStatus: () => true
  });
  if (resp.status !== 200) {
    throw new Error(`Session start failed: ${resp.status}`);
  }
  return resp;
}

