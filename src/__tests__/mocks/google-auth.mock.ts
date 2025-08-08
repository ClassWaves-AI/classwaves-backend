import { jest } from '@jest/globals';

// Remove explicit typing for jest.fn() to avoid TypeScript issues

// Mock Google OAuth2Client
export const mockGoogleOAuth2Client = {
  getToken: jest.fn().mockResolvedValue({
    tokens: {
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      id_token: 'mock-id-token',
      token_type: 'Bearer',
      expiry_date: Date.now() + 3600000,
    },
  }),
  verifyIdToken: jest.fn().mockResolvedValue({
    getPayload: jest.fn().mockReturnValue({
      iss: 'https://accounts.google.com',
      sub: 'google-user-123',
      email: 'teacher@school.edu',
      email_verified: true,
      name: 'Test Teacher',
      picture: 'https://example.com/picture.jpg',
      given_name: 'Test',
      family_name: 'Teacher',
      locale: 'en',
      hd: 'school.edu',
    }),
  }),
  refreshAccessToken: jest.fn().mockResolvedValue({
    credentials: {
      access_token: 'new-mock-access-token',
      refresh_token: 'mock-refresh-token',
      token_type: 'Bearer',
      expiry_date: Date.now() + 3600000,
    },
  }),
  setCredentials: jest.fn(),
  revokeToken: jest.fn().mockResolvedValue({}),
};

// Mock Google People API
export const mockGooglePeopleAPI = {
  people: {
    get: jest.fn().mockResolvedValue({
      data: {
        resourceName: 'people/123',
        emailAddresses: [{ value: 'teacher@school.edu' }],
        names: [{ displayName: 'Test Teacher' }],
        photos: [{ url: 'https://example.com/picture.jpg' }],
      },
    }),
  },
};

// Helper function to create mock ID token payload
export const createMockIdTokenPayload = (overrides?: Partial<any>) => ({
  iss: 'https://accounts.google.com',
  sub: 'google-user-123',
  email: 'teacher@school.edu',
  email_verified: true,
  name: 'Test Teacher',
  picture: 'https://example.com/picture.jpg',
  given_name: 'Test',
  family_name: 'Teacher',
  locale: 'en',
  hd: 'school.edu',
  ...overrides,
});

// Helper to reset all Google mocks
export const resetGoogleMocks = () => {
  Object.values(mockGoogleOAuth2Client).forEach(mock => {
    if (typeof mock === 'function' && 'mockReset' in mock) {
      (mock as any).mockReset();
    }
  });
  
  if (mockGooglePeopleAPI.people.get.mockReset) {
    mockGooglePeopleAPI.people.get.mockReset();
  }
};

// Helper to setup Google auth error
export const setupGoogleAuthError = (error: Error) => {
  mockGoogleOAuth2Client.getToken.mockRejectedValue(error);
  mockGoogleOAuth2Client.verifyIdToken.mockRejectedValue(error);
};

// Helper to setup invalid token
export const setupInvalidGoogleToken = () => {
  mockGoogleOAuth2Client.verifyIdToken.mockResolvedValue({
    getPayload: jest.fn().mockReturnValue(null),
  });
};