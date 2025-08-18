#!/usr/bin/env node

/**
 * ClassWaves Feature Scanner
 * 
 * Automatically detects and updates feature status across all repositories
 * Provides real-time answers to: What's built? What's building? What's planned?
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class FeatureScanner {
  constructor() {
    this.registryPath = path.join('..', 'checkpoints', 'FEATURE_REGISTRY');
    this.repos = [
      'classwaves-backend',
      'classwaves-frontend', 
      'classwaves-student',
      'classwaves-shared'
    ];
  }

  async scanAllFeatures() {
    console.log('🔍 CLASSWAVES FEATURE REGISTRY SCAN');
    console.log('====================================\n');
    
    const registry = this.loadRegistry();
    console.log(`📊 Scanning ${registry.features.length} features across ${this.repos.length} repositories\n`);
    
    const updatedFeatures = [];
    
    for (const featureRef of registry.features) {
      console.log(`🔍 Scanning: ${featureRef.name}`);
      
      try {
        const feature = this.loadFeatureDefinition(featureRef.definition_file);
        const updatedFeature = await this.scanFeature(feature);
        updatedFeatures.push(updatedFeature);
        
        // Save updated feature definition
        this.saveFeatureDefinition(featureRef.definition_file, updatedFeature);
        
        console.log(`   ✅ Status: ${updatedFeature.status.current} (${updatedFeature.status.completion_percentage}%)`);
      } catch (error) {
        console.log(`   ❌ Error scanning feature: ${error.message}`);
        // Keep original feature data if scan fails
        const feature = this.loadFeatureDefinition(featureRef.definition_file);
        updatedFeatures.push(feature);
      }
    }
    
    // Update registry with scan results
    registry.features = updatedFeatures.map((feature, index) => ({
      ...registry.features[index],
      status: feature.status.current,
      completion: feature.status.completion_percentage
    }));
    
    registry.last_scan = new Date().toISOString();
    registry.summary = this.calculateSummary(updatedFeatures);
    
    this.saveRegistry(registry);
    this.generateReports(registry, updatedFeatures);
    
    console.log('\n✅ FEATURE SCAN COMPLETE');
    this.printSummary(registry);
  }

  loadRegistry() {
    const registryFile = path.join(this.registryPath, 'registry.json');
    if (!fs.existsSync(registryFile)) {
      throw new Error(`Registry file not found: ${registryFile}`);
    }
    return JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  }

  saveRegistry(registry) {
    const registryFile = path.join(this.registryPath, 'registry.json');
    fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2));
  }

  loadFeatureDefinition(definitionFile) {
    const featureFile = path.join(this.registryPath, definitionFile);
    if (!fs.existsSync(featureFile)) {
      throw new Error(`Feature definition not found: ${featureFile}`);
    }
    return JSON.parse(fs.readFileSync(featureFile, 'utf8'));
  }

  saveFeatureDefinition(definitionFile, feature) {
    const featureFile = path.join(this.registryPath, definitionFile);
    fs.writeFileSync(featureFile, JSON.stringify(feature, null, 2));
  }

  async scanFeature(feature) {
    const updated = JSON.parse(JSON.stringify(feature)); // Deep clone
    
    // Scan backend implementation
    if (feature.implementation.backend) {
      updated.implementation.backend = await this.scanBackendImplementation(feature);
    }
    
    // Scan frontend implementation  
    if (feature.implementation.frontend) {
      updated.implementation.frontend = await this.scanFrontendImplementation(feature);
    }
    
    // Update overall status
    updated.status = this.calculateOverallStatus(updated);
    updated.status.last_updated = new Date().toISOString();
    updated.status.updated_by = 'automated_scan';
    
    return updated;
  }

  async scanBackendImplementation(feature) {
    const backend = JSON.parse(JSON.stringify(feature.implementation.backend));
    
    // Check if key files exist
    const existingFiles = backend.key_files.filter(file => 
      fs.existsSync(path.join('..', file))
    );
    
    backend.files_exist = existingFiles.length;
    backend.files_total = backend.key_files.length;
    backend.files_percentage = Math.round((existingFiles.length / backend.key_files.length) * 100);
    
    // Check database tables (using existing db:check)
    try {
      const dbCheck = this.safeExec('npm run db:check', 'Database check');
      backend.database_status = this.analyzeDatabaseStatus(dbCheck, backend.database_tables);
    } catch (error) {
      backend.database_status = 'error';
    }
    
    // Check test status
    try {
      const testPattern = feature.id.replace(/-/g, '.*');
      const testResult = this.safeExec(
        `npm test -- --testNamePattern="${testPattern}" --passWithNoTests --silent`, 
        'Test check'
      );
      backend.tests.unit = this.analyzeTestResults(testResult);
    } catch (error) {
      backend.tests.unit = 'error';
    }
    
    // Calculate backend completion
    backend.completion_percentage = this.calculateBackendCompletion(backend);
    
    return backend;
  }

  async scanFrontendImplementation(feature) {
    const frontend = JSON.parse(JSON.stringify(feature.implementation.frontend));
    
    // Check if components exist
    const existingFiles = frontend.key_files.filter(file => 
      fs.existsSync(path.join('..', file))
    );
    
    frontend.files_exist = existingFiles.length;
    frontend.files_total = frontend.key_files.length;
    frontend.files_percentage = Math.round((existingFiles.length / frontend.key_files.length) * 100);
    
    // Calculate frontend completion
    frontend.completion_percentage = this.calculateFrontendCompletion(frontend);
    
    return frontend;
  }

  calculateOverallStatus(feature) {
    const backend = feature.implementation.backend;
    const frontend = feature.implementation.frontend;
    
    let totalCompletion = 0;
    let componentCount = 0;
    
    if (backend) {
      totalCompletion += backend.completion_percentage || 0;
      componentCount++;
    }
    
    if (frontend) {
      totalCompletion += frontend.completion_percentage || 0;
      componentCount++;
    }
    
    const averageCompletion = componentCount > 0 ? Math.round(totalCompletion / componentCount) : 0;
    
    // Determine status based on completion and other factors
    let status = 'planned';
    if (averageCompletion >= 95 && backend?.tests?.unit === 'passing') {
      status = 'production_ready';
    } else if (averageCompletion >= 80) {
      status = 'feature_complete';
    } else if (averageCompletion >= 20) {
      status = 'in_progress';
    }
    
    return {
      current: status,
      completion_percentage: averageCompletion
    };
  }

  calculateBackendCompletion(backend) {
    let score = 0;
    let maxScore = 0;
    
    // Files exist (40% weight)
    score += (backend.files_percentage || 0) * 0.4;
    maxScore += 40;
    
    // Database tables (20% weight)
    if (backend.database_status === 'exists') {
      score += 20;
    }
    maxScore += 20;
    
    // Unit tests (30% weight)
    if (backend.tests.unit === 'passing') {
      score += 30;
    } else if (backend.tests.unit === 'failing') {
      score += 10;
    }
    maxScore += 30;
    
    // Integration tests (10% weight)
    if (backend.tests.integration === 'passing') {
      score += 10;
    }
    maxScore += 10;
    
    return Math.round((score / maxScore) * 100);
  }

  calculateFrontendCompletion(frontend) {
    let score = 0;
    let maxScore = 0;
    
    // Files exist (60% weight)
    score += (frontend.files_percentage || 0) * 0.6;
    maxScore += 60;
    
    // Unit tests (25% weight)
    if (frontend.tests.unit === 'passing') {
      score += 25;
    } else if (frontend.tests.unit === 'failing') {
      score += 10;
    }
    maxScore += 25;
    
    // E2E tests (15% weight)
    if (frontend.tests.e2e === 'passing') {
      score += 15;
    }
    maxScore += 15;
    
    return Math.round((score / maxScore) * 100);
  }

  analyzeDatabaseStatus(dbCheckOutput, requiredTables) {
    if (!dbCheckOutput || dbCheckOutput.includes('failed') || dbCheckOutput.includes('error')) {
      return 'error';
    }
    
    // Check if required tables are mentioned in the output
    const foundTables = requiredTables.filter(table => 
      dbCheckOutput.includes(table.split('.').pop()) // Check for table name
    );
    
    if (foundTables.length === requiredTables.length) {
      return 'exists';
    } else if (foundTables.length > 0) {
      return 'partial';
    } else {
      return 'missing';
    }
  }

  analyzeTestResults(testOutput) {
    if (!testOutput) return 'missing';
    
    if (testOutput.includes('PASS') && !testOutput.includes('FAIL')) {
      return 'passing';
    } else if (testOutput.includes('FAIL')) {
      return 'failing';
    } else {
      return 'missing';
    }
  }

  calculateSummary(features) {
    const statusCounts = {
      production_ready: 0,
      feature_complete: 0,
      in_progress: 0,
      planned: 0,
      blocked: 0,
      deprecated: 0
    };
    
    let totalCompletion = 0;
    
    features.forEach(feature => {
      statusCounts[feature.status.current] = (statusCounts[feature.status.current] || 0) + 1;
      totalCompletion += feature.status.completion_percentage;
    });
    
    return {
      total_features: features.length,
      production_ready: statusCounts.production_ready,
      feature_complete: statusCounts.feature_complete,
      in_progress: statusCounts.in_progress,
      planned: statusCounts.planned,
      blocked: statusCounts.blocked,
      overall_completion: Math.round(totalCompletion / features.length) + '%'
    };
  }

  generateReports(registry, features) {
    // Ensure reports directory exists
    const reportsDir = path.join(this.registryPath, 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    // Generate feature status report
    const statusReport = this.generateStatusReport(registry, features);
    fs.writeFileSync(
      path.join(reportsDir, 'feature-status-report.md'),
      statusReport
    );
    
    // Generate completion dashboard
    const dashboard = this.generateDashboard(registry, features);
    fs.writeFileSync(
      path.join(reportsDir, 'completion-dashboard.md'), 
      dashboard
    );
    
    // Generate developer quick reference
    const quickRef = this.generateQuickReference(registry, features);
    fs.writeFileSync(
      path.join(reportsDir, 'developer-quick-reference.md'),
      quickRef
    );
  }

  generateStatusReport(registry, features) {
    const productionReady = features.filter(f => f.status.current === 'production_ready');
    const featureComplete = features.filter(f => f.status.current === 'feature_complete');
    const inProgress = features.filter(f => f.status.current === 'in_progress');
    const planned = features.filter(f => f.status.current === 'planned');
    
    return `# ClassWaves Feature Status Report

Generated: ${new Date().toISOString()}
Last Scan: ${registry.last_scan}

## 📊 Overall Progress: ${registry.summary.overall_completion}

**Total Features**: ${registry.summary.total_features}

## 🚀 Production Ready Features (${productionReady.length})
${productionReady.map(f => `- ✅ **${f.name}** (${f.status.completion_percentage}%)`).join('\n') || '- None'}

## 🎯 Feature Complete (${featureComplete.length})
${featureComplete.map(f => `- 🎯 **${f.name}** (${f.status.completion_percentage}%)`).join('\n') || '- None'}

## 🔄 In Progress Features (${inProgress.length})  
${inProgress.map(f => `- 🔄 **${f.name}** (${f.status.completion_percentage}%)`).join('\n') || '- None'}

## 📋 Planned Features (${planned.length})
${planned.map(f => `- 📋 **${f.name}** (${f.status.completion_percentage}%)`).join('\n') || '- None'}

## 🎯 Current Sprint Focus
${registry.development_pipeline?.current_sprint ? `
**Sprint**: ${registry.development_pipeline.current_sprint.name}
**Duration**: ${registry.development_pipeline.current_sprint.start_date} to ${registry.development_pipeline.current_sprint.end_date}
**Goals**:
${registry.development_pipeline.current_sprint.goals.map(goal => `- ${goal}`).join('\n')}
` : '- No current sprint defined'}

## 📈 Quality Metrics
- **Overall Test Coverage**: ${registry.quality_metrics?.overall_test_coverage || 'Unknown'}
- **Production Ready**: ${Math.round((productionReady.length / features.length) * 100)}%
- **Features with Documentation**: ${registry.quality_metrics?.features_with_documentation || 'Unknown'}
- **Features with Complete Tests**: ${registry.quality_metrics?.features_with_complete_tests || 'Unknown'}
`;
  }

  generateDashboard(registry, features) {
    return `# ClassWaves Development Pipeline Dashboard

Generated: ${new Date().toISOString()}

## 📊 Overall Progress: ${registry.summary.overall_completion}

### 🎯 Feature Status Breakdown
- 🚀 **Production Ready**: ${registry.summary.production_ready} features
- 🎯 **Feature Complete**: ${registry.summary.feature_complete} features  
- 🔄 **In Progress**: ${registry.summary.in_progress} features
- 📋 **Planned**: ${registry.summary.planned} features

### 🚧 Technical Debt & Priorities
${registry.technical_debt ? `
**Missing Integration Tests**: ${registry.technical_debt.missing_integration_tests?.join(', ') || 'None'}
**Missing E2E Tests**: ${registry.technical_debt.missing_e2e_tests?.join(', ') || 'None'}
**Missing API Documentation**: ${registry.technical_debt.missing_api_documentation?.join(', ') || 'None'}
**Low Test Coverage**: ${registry.technical_debt.low_test_coverage?.join(', ') || 'None'}
` : '- Technical debt analysis not available'}

### 📈 Development Velocity
- **Total Features**: ${registry.summary.total_features}
- **Completion Rate**: ${registry.summary.overall_completion}
- **Production Ready Rate**: ${Math.round((registry.summary.production_ready / registry.summary.total_features) * 100)}%

### 🎯 Next Sprint Planning
${registry.development_pipeline?.next_sprint ? `
**Planned Sprint**: ${registry.development_pipeline.next_sprint.name}
**Duration**: ${registry.development_pipeline.next_sprint.planned_start} to ${registry.development_pipeline.next_sprint.planned_end}
**Focus Features**: ${registry.development_pipeline.next_sprint.focus_features?.join(', ') || 'TBD'}
` : '- Next sprint not planned'}
`;
  }

  generateQuickReference(registry, features) {
    const productionReady = features.filter(f => f.status.current === 'production_ready');
    const inProgress = features.filter(f => f.status.current === 'in_progress');
    
    return `# Developer Quick Reference

Generated: ${new Date().toISOString()}

## 🔍 Feature Registry Commands
\`\`\`bash
npm run feature-scan                    # Full registry scan
npm run feature-status <feature-name>   # Specific feature status
npm run architecture-scan               # System architecture overview
\`\`\`

## 🚀 Production Ready Features
${productionReady.map(f => `
### ${f.name}
- **Status**: ${f.status.current} (${f.status.completion_percentage}%)
- **Backend Files**: ${f.implementation.backend?.key_files?.slice(0, 3).join(', ') || 'None'}${f.implementation.backend?.key_files?.length > 3 ? '...' : ''}
- **Frontend Files**: ${f.implementation.frontend?.key_files?.slice(0, 3).join(', ') || 'None'}${f.implementation.frontend?.key_files?.length > 3 ? '...' : ''}
`).join('\n') || '- None available'}

## 🔄 Work In Progress
${inProgress.map(f => `
### ${f.name} (${f.status.completion_percentage}%)
- **Backend**: ${f.implementation.backend?.completion_percentage || 0}% complete
- **Frontend**: ${f.implementation.frontend?.completion_percentage || 0}% complete
- **Next Steps**: Review feature definition for priorities
`).join('\n') || '- None in progress'}

## 📋 Quick File Locations
\`\`\`
Backend Services: classwaves-backend/src/services/
Frontend Components: classwaves-frontend/src/features/
Tests: */src/__tests__/
Documentation: checkpoints/WIP/Features/
\`\`\`
`;
  }

  safeExec(command, description) {
    try {
      const result = execSync(command, { 
        encoding: 'utf8', 
        timeout: 30000,
        stdio: 'pipe'
      });
      return result.trim();
    } catch (error) {
      console.log(`   ⚠️ ${description} failed: ${error.message.split('\n')[0]}`);
      return null;
    }
  }

  printSummary(registry) {
    console.log('\n📊 FEATURE REGISTRY SUMMARY');
    console.log('============================');
    console.log(`🚀 Production Ready: ${registry.summary.production_ready}`);
    console.log(`🎯 Feature Complete: ${registry.summary.feature_complete || 0}`);
    console.log(`🔄 In Progress: ${registry.summary.in_progress}`);
    console.log(`📋 Planned: ${registry.summary.planned}`);
    console.log(`📈 Overall Completion: ${registry.summary.overall_completion}`);
    console.log(`📊 Total Features: ${registry.summary.total_features}`);
    
    console.log('\n📋 Generated Reports:');
    console.log('- checkpoints/FEATURE_REGISTRY/reports/feature-status-report.md');
    console.log('- checkpoints/FEATURE_REGISTRY/reports/completion-dashboard.md');
    console.log('- checkpoints/FEATURE_REGISTRY/reports/developer-quick-reference.md');
  }
}

// Run the scanner
if (require.main === module) {
  const scanner = new FeatureScanner();
  scanner.scanAllFeatures().catch(console.error);
}

module.exports = FeatureScanner;
