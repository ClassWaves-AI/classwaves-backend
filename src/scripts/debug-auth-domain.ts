import dotenv from 'dotenv';
import { databricksService } from '../services/databricks.service';
import { logger } from '../utils/logger';

dotenv.config();

async function main() {
  const domain = process.argv[2] || 'classwaves.ai';
  const email = process.argv[3] || 'rob@classwaves.ai';

  try {
    logger.debug('Connecting to Databricks...');
    await databricksService.connect();
    logger.debug('Connected.');

    logger.debug('\nListing all schools (domain, status, name, id):');
    const schools = await databricksService.query<any>(
      `SELECT domain, subscription_status, name, id FROM classwaves.users.schools`
    );
    console.table(schools);

    logger.debug(`\nQuerying school by domain: ${domain}`);
    const school = await databricksService.getSchoolByDomain(domain);
    logger.debug('School result:', school);

    logger.debug(`\nQuerying teacher by email: ${email}`);
    const teacher = await databricksService.getTeacherByEmail(email);
    logger.debug('Teacher result:', teacher);

  } catch (err) {
    logger.error('Error during debug:', err);
  } finally {
    await databricksService.disconnect();
  }
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});

