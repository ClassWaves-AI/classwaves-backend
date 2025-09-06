import { databricksService } from '../../services/databricks.service';
import { databricksConfig } from '../../config/databricks.config';
import type { ComplianceRepositoryPort } from '../../services/ports/compliance.repository.port';

export class DatabricksComplianceRepository implements ComplianceRepositoryPort {
  async hasParentalConsentByStudentName(name: string): Promise<boolean> {
    const sql = `SELECT id FROM ${databricksConfig.catalog}.compliance.parental_consents WHERE student_name = ?`;
    const rows = await databricksService.query(sql, [name]);
    return Array.isArray(rows) && rows.length > 0;
  }
}

export const complianceRepository: ComplianceRepositoryPort = new DatabricksComplianceRepository();

