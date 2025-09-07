export interface ComplianceRepositoryPort {
  hasParentalConsentByStudentName(name: string): Promise<boolean>;
}

