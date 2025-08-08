/// <reference types="jest" />

declare namespace jest {
  interface Matchers<R> {
    // Add custom matchers here if needed
  }
}

// Fix for mock types
type MockedFunction<T extends (...args: any[]) => any> = jest.MockedFunction<T>;
type MockedObject<T> = jest.Mocked<T>;

// Extend Express Request type to include user property
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        schoolId: string;
        role: string;
      };
    }
  }
}