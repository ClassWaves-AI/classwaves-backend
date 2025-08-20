// Quick debug script to test validator logic
const { DatabaseSchemaValidator } = require('./src/scripts/database-schema-validator.ts');

// Simple test to see what's failing
async function testValidator() {
  console.log('🔍 Testing validator logic...');
  
  const validator = new DatabaseSchemaValidator();
  
  try {
    const result = await validator.validateSchema();
    console.log('Success:', result.success);
    console.log('Critical Errors:', result.criticalErrors);
    console.log('Valid Schemas:', result.summary.validSchemas, '/', result.summary.totalSchemas);
  } catch (error) {
    console.log('Error:', error.message);
  }
}

testValidator();
