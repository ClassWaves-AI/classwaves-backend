import dotenv from 'dotenv';
import { databricksService } from '../services/databricks.service';

dotenv.config();

async function main() {
  const domain = process.argv[2] || 'classwaves.ai';
  const email = process.argv[3] || 'rob@classwaves.ai';

  try {
    console.log('Connecting to Databricks...');
    await databricksService.connect();
    console.log('Connected.');

    console.log('\nListing all schools (domain, status, name, id):');
    const schools = await databricksService.query<any>(
      `SELECT domain, subscription_status, name, id FROM classwaves.users.schools`
    );
    console.table(schools);

    console.log(`\nQuerying school by domain: ${domain}`);
    const school = await databricksService.getSchoolByDomain(domain);
    console.log('School result:', school);

    console.log(`\nQuerying teacher by email: ${email}`);
    const teacher = await databricksService.getTeacherByEmail(email);
    console.log('Teacher result:', teacher);

  } catch (err) {
    console.error('Error during debug:', err);
  } finally {
    await databricksService.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


