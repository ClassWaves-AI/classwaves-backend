/**
 * Unit tests for EmailComplianceService
 */

import { emailComplianceService } from '../../../services/email-compliance.service';

jest.mock('../../../services/databricks.service');
const mockDatabricksService = require('../../../services/databricks.service');

describe('EmailComplianceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDatabricksService.databricksService = {
      queryOne: jest.fn(),
    };
  });

  it('allows sending when teacher_verified_age is true', async () => {
    mockDatabricksService.databricksService.queryOne.mockResolvedValueOnce({
      id: 'stu-1',
      teacher_verified_age: true,
      coppa_compliant: false,
      email_consent: false,
    });
    const res = await emailComplianceService.validateEmailConsent('stu-1');
    expect(res.canSendEmail).toBe(true);
    expect(res.consentStatus).toBe('consented');
  });

  it('blocks when COPPA not verified and teacher has not verified age', async () => {
    mockDatabricksService.databricksService.queryOne.mockResolvedValueOnce({
      id: 'stu-2',
      teacher_verified_age: false,
      coppa_compliant: false,
      email_consent: true,
    });
    const res = await emailComplianceService.validateEmailConsent('stu-2');
    expect(res.canSendEmail).toBe(false);
    expect(res.consentStatus).toBe('coppa_verification_required_by_teacher');
  });

  it('blocks when COPPA verified but email consent is not granted', async () => {
    mockDatabricksService.databricksService.queryOne.mockResolvedValueOnce({
      id: 'stu-3',
      teacher_verified_age: false,
      coppa_compliant: true,
      email_consent: false,
    });
    const res = await emailComplianceService.validateEmailConsent('stu-3');
    expect(res.canSendEmail).toBe(false);
    expect(res.consentStatus).toBe('email_consent_required');
  });

  it('falls back to legacy columns when new fields missing', async () => {
    // Simulate new path throwing by making first call throw, then legacy returning has_parental_consent
    const queryOne = mockDatabricksService.databricksService.queryOne;
    queryOne.mockRejectedValueOnce(new Error('TABLE_OR_VIEW_NOT_FOUND'));
    queryOne.mockResolvedValueOnce({ id: 'stu-4', has_parental_consent: true, parent_email: 'p@example.com' });
    const res = await emailComplianceService.validateEmailConsent('stu-4');
    expect(res.canSendEmail).toBe(true);
    expect(res.consentStatus).toBe('consented');
  });
});

