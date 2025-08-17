#!/usr/bin/env node

/**
 * ClassWaves Architecture Scanner
 * 
 * Automatically gathers comprehensive system context for AI development tasks
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔍 CLASSWAVES ARCHITECTURE SCAN');
console.log('================================\n');

// Helper function to safely execute commands
function safeExec(command, description) {
  try {
    const result = execSync(command, { encoding: 'utf8', timeout: 10000 });
    return result.trim();
  } catch (error) {
    return `❌ ${description} failed: ${error.message}`;
  }
}

// Helper function to check if service is running
async function checkService(url, name) {
  try {
    const response = await fetch(url);
    return response.ok ? '✅ ONLINE' : '⚠️ UNHEALTHY';
  } catch (error) {
    return '❌ OFFLINE';
  }
}

// 1. SERVICE STATUS
console.log('📊 SERVICE STATUS:');
console.log('==================');

// Check if we're in the right directory
const currentDir = process.cwd();
const isBackend = currentDir.includes('classwaves-backend');
const isContainer = fs.existsSync('classwaves-backend') && fs.existsSync('classwaves-frontend');

if (isBackend) {
  console.log('📍 Current Location: Backend Directory');
} else if (isContainer) {
  console.log('📍 Current Location: Container Directory');
} else {
  console.log('📍 Current Location: Unknown - may need to navigate to project root');
}

// Service health checks (these would be async in real implementation)
console.log('Backend (3000): [Health check would go here]');
console.log('Frontend (3001): [Health check would go here]');
console.log('Student (3003): [Health check would go here]');

// 2. DATABASE STATUS
console.log('\n📋 DATABASE STATUS:');
console.log('===================');

const dbCheck = safeExec('npm run db:check 2>/dev/null || echo "No db:check script found"', 'Database check');
console.log(dbCheck);

// 3. GIT STATUS
console.log('\n🔧 GIT STATUS:');
console.log('===============');

const gitBranch = safeExec('git branch --show-current', 'Git branch check');
const gitStatus = safeExec('git status --porcelain', 'Git status check');
const lastCommit = safeExec('git log -1 --oneline', 'Last commit check');

console.log(`Branch: ${gitBranch}`);
console.log(`Last Commit: ${lastCommit}`);
console.log(`Uncommitted Changes: ${gitStatus ? gitStatus.split('\n').length + ' files' : 'None'}`);

// 4. TEST STATUS
console.log('\n🧪 TEST STATUS:');
console.log('================');

const testResult = safeExec('npm test -- --passWithNoTests --silent 2>/dev/null | grep -E "(PASS|FAIL|Tests:|Snapshots:)" || echo "No tests found or test command failed"', 'Test status check');
console.log(testResult);

// 5. PROJECT STRUCTURE
console.log('\n📁 KEY FILES:');
console.log('==============');

const keyPatterns = [
  '**/*analytics*service*.ts',
  '**/*analytics*controller*.ts', 
  '**/*analytics*test*.ts',
  '**/SessionAnalyticsPanel.tsx',
  '**/AnalyticsErrorState.tsx'
];

// Simple file finder (would use proper glob in real implementation)
function findFiles(pattern) {
  try {
    // This is a simplified version - real implementation would use glob
    const result = safeExec(`find . -name "*analytics*" -type f | head -10`, 'File search');
    return result.split('\n').filter(line => line.trim());
  } catch (error) {
    return [];
  }
}

const analyticsFiles = findFiles('analytics');
analyticsFiles.forEach(file => {
  if (file) console.log(`  ${file}`);
});

// 6. ENVIRONMENT INFO
console.log('\n🌍 ENVIRONMENT:');
console.log('================');

console.log(`Node Version: ${process.version}`);
console.log(`NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
console.log(`Platform: ${process.platform}`);

// 7. PACKAGE INFO
console.log('\n📦 DEPENDENCIES:');
console.log('=================');

if (fs.existsSync('package.json')) {
  try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    console.log(`Project: ${packageJson.name}`);
    console.log(`Version: ${packageJson.version}`);
    
    // Key dependencies for analytics
    const keyDeps = ['jest', '@databricks/sql', 'socket.io', '@tanstack/react-query'];
    keyDeps.forEach(dep => {
      if (packageJson.dependencies?.[dep] || packageJson.devDependencies?.[dep]) {
        const version = packageJson.dependencies?.[dep] || packageJson.devDependencies?.[dep];
        console.log(`  ${dep}: ${version}`);
      }
    });
  } catch (error) {
    console.log('❌ Could not read package.json');
  }
} else {
  console.log('❌ No package.json found in current directory');
}

// 8. FEATURE STATUS
console.log('\n🎯 FEATURE STATUS:');
console.log('===================');

// Check if SOW document exists
const sowPath = '../checkpoints/WIP/Features/SESSIONS_AND_GROUPS_REALTIME_ANALYTICS_IMPLEMENTATION_PLAN.md';
if (fs.existsSync(sowPath)) {
  console.log('✅ SOW Document: Found');
  
  try {
    const sowContent = fs.readFileSync(sowPath, 'utf8');
    
    // Count completed items
    const completedItems = (sowContent.match(/- \[x\]/g) || []).length;
    const totalItems = (sowContent.match(/- \[[x ]\]/g) || []).length;
    
    console.log(`📊 Completion: ${completedItems}/${totalItems} items (${Math.round(completedItems/totalItems*100)}%)`);
    
    // Check for production ready status
    if (sowContent.includes('PRODUCTION READY')) {
      console.log('🚀 Status: PRODUCTION READY');
    } else if (sowContent.includes('NOT PRODUCTION READY')) {
      console.log('⚠️ Status: NOT PRODUCTION READY');
    }
  } catch (error) {
    console.log('❌ Could not analyze SOW document');
  }
} else {
  console.log('❌ SOW Document: Not found');
}

console.log('\n✅ ARCHITECTURE SCAN COMPLETE');
console.log('==============================');
console.log('💡 This context can now be used for informed development decisions');
