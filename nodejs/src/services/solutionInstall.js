const { handleError } = require('../utils/helper');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const SOLUTION_CONFIGS = require('../config/solutionconfig');

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Executes bash commands with console output
 * @param {string} command - The bash command to execute
 * @returns {Promise<string>} - Command output
 */
function runCommand(command) {
    return new Promise((resolve, reject) => {
        const child = spawn('sh', ['-c', command], { stdio: 'inherit' });
        
        child.on('close', (code) => {
            if (code === 0) {
                resolve('success');
            } else {
                reject(new Error(`Command failed: ${command}`));
            }
        });
        
        child.on('error', (error) => {
            reject(error);
        });
    });
}

/**
 * Merges environment variables from root and local .env files
 * Priority: Local values take precedence, but if local value is empty, use root value
 * @param {string} rootEnvPath - Path to root .env file
 * @param {string} localEnvPath - Path to local .env file
 * @param {string} outputPath - Path where to write the merged .env file
 * @returns {Promise<object>} - Merged environment variables
 */
async function mergeEnvironmentFiles(rootEnvPath, localEnvPath, outputPath) {
    try {
        const rootVars = {};
        const localVars = {};
        const mergedVars = {};
        
        // Read root .env file
        if (fs.existsSync(rootEnvPath)) {
            const rootContent = fs.readFileSync(rootEnvPath, 'utf8');
            rootContent.split('\n').forEach(line => {
                const trimmedLine = line.trim();
                if (trimmedLine && !trimmedLine.startsWith('#') && trimmedLine.includes('=')) {
                    const [key, ...valueParts] = trimmedLine.split('=');
                    rootVars[key.trim()] = valueParts.join('=').trim();
                }
            });
        }
        
        // Read local .env file
        if (fs.existsSync(localEnvPath)) {
            const localContent = fs.readFileSync(localEnvPath, 'utf8');
            localContent.split('\n').forEach(line => {
                const trimmedLine = line.trim();
                if (trimmedLine && !trimmedLine.startsWith('#') && trimmedLine.includes('=')) {
                    const [key, ...valueParts] = trimmedLine.split('=');
                    localVars[key.trim()] = valueParts.join('=').trim();
                }
            });
        }
        
        // Merge logic: Start with root values, then add local-only variables
        // If variable exists in both root and local, use root value (skip local)
        // If variable exists only in local, keep it (even if empty)
        
        // Start with all root variables
        Object.keys(rootVars).forEach(key => {
            mergedVars[key] = rootVars[key];
        });
        
        // Add local variables that don't exist in root
        Object.keys(localVars).forEach(key => {
            if (!rootVars.hasOwnProperty(key)) {
                // This variable doesn't exist in root, so keep it from local (even if empty)
                mergedVars[key] = localVars[key];
            }
            // If variable exists in both root and local, we already have root value (skip local)
        });
        
        // Write merged .env file to output path (not modifying original files)
        const envContent = Object.entries(mergedVars)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');
        
        fs.writeFileSync(outputPath, envContent);
        console.log(`✅ Merged ${Object.keys(mergedVars).length} environment variables (root values used for common variables)`);
        
        return mergedVars;
    } catch (error) {
        console.error('❌ Error merging environment files:', error);
        throw error;
    }
}

/**
 * Detects if Docker Compose is available
 * @returns {Promise<boolean>} - True if docker-compose is available
 */
async function isDockerComposeAvailable() {
    try {
        await runCommand('docker-compose --version');
        return true;
    } catch (error) {
        try {
            await runCommand('docker compose version');
            return true;
        } catch (error) {
            return false;
        }
    }
}

/**
 * Installs Docker Compose if not available
 * @returns {Promise<void>}
 */
async function installDockerCompose() {
    try {
        console.log('📦 Installing Docker Compose...');
        await runCommand('wget -O /usr/local/bin/docker-compose "https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-$(uname -s)-$(uname -m)" && chmod +x /usr/local/bin/docker-compose');
        console.log('✅ Docker Compose installed successfully');
    } catch (error) {
        console.log('⚠️ Docker Compose installation failed, continuing with fallback...');
    }
}

/**
 * Detects repository structure and determines installation method
 * @param {string} repoPath - Path to repository
 * @returns {Promise<object>} - Repository structure info
 */
async function detectRepoStructure(repoPath) {
    const structure = {
        hasDockerCompose: false,
        hasDockerfile: false,
        composeFile: null
    };
    
    try {
        // Check for docker-compose files
        const composeFiles = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
        for (const file of composeFiles) {
            if (fs.existsSync(path.join(repoPath, file))) {
                structure.hasDockerCompose = true;
                structure.composeFile = file;
                break;
            }
        }
        
        // Check for Dockerfile
        if (fs.existsSync(path.join(repoPath, 'Dockerfile'))) {
            structure.hasDockerfile = true;
        }
        
        return structure;
    } catch (error) {
        console.error('❌ Error detecting repository structure:', error);
        return structure;
    }
}

/**
 * Stops and removes existing containers
 * @param {object} config - Solution configuration
 * @returns {Promise<void>}
 */
async function cleanupExistingContainers(config) {
    try {
        console.log('🧹 Cleaning up existing containers...');
        
        // Stop and remove main container
        await runCommand(`docker rm -f ${config.containerName} || true`);
        
        // Stop containers using additional ports
        if (config.additionalPorts) {
            for (const port of config.additionalPorts) {
                await runCommand(`docker ps -q --filter "publish=${port}" | xargs -r docker stop || true`);
            }
        }
        
        console.log('✅ Existing containers cleaned up');
    } catch (error) {
        console.log('⚠️ Error cleaning up containers:', error.message);
    }
}

/**
 * Installs Docker service (single container)
 * @param {object} config - Solution configuration
 * @param {string} repoPath - Repository path
 * @returns {Promise<void>}
 */
async function installDockerService(config, repoPath) {
    console.log('🐳 Installing Docker service...');
    
    // Setup environment - ensure .env is exactly like .env.example
    if (config.envFile) {
        await runCommand(`cp ${repoPath}/${config.envFile} ${repoPath}/.env`);
    }
    
    // Create merged temporary file for build (don't touch original .env)
    const rootEnvPath = '/workspace/.env';
    const localEnvPath = `${repoPath}/.env`;
    const tempEnvPath = `${repoPath}/.env.temp`;
    
    // Create merged temporary file
    await mergeEnvironmentFiles(rootEnvPath, localEnvPath, tempEnvPath);
    
    // Use temporary .env file for build
    await runCommand(`cp ${tempEnvPath} ${localEnvPath}`);
    
    // Build Docker image
    console.log('🔨 Building Docker image...');
    await runCommand(`docker build -t ${config.imageName} ${repoPath}`);
    
    // Run container
    console.log('🚀 Starting container...');
    const networkName = 'weam_app-network';
    await runCommand(`docker run -d --name ${config.containerName} --network ${networkName} -p ${config.port}:${config.port} ${config.imageName}`);
    
    // Restore original .env file (exactly like .env.example) and clean up
    await runCommand(`cp ${repoPath}/${config.envFile} ${repoPath}/.env`);
    await runCommand(`rm -f ${tempEnvPath}`);
}

/**
 * Installs Docker Compose service (multiple containers)
 * @param {object} config - Solution configuration
 * @param {string} repoPath - Repository path
 * @returns {Promise<void>}
 */
async function installDockerComposeService(config, repoPath) {
    console.log('🐳 Installing Docker Compose service...');
    
    // Setup environment files - ensure .env is exactly like .env.example
    await runCommand(`find ${repoPath} -name ".env.example" -exec sh -c 'cp "$1" "$(dirname "$1")/.env"' _ {} \\;`);
    
    // Create merged temporary file for build (don't touch original .env)
    const rootEnvPath = '/workspace/.env';
    const localEnvPath = `${repoPath}/.env`;
    const tempEnvPath = `${repoPath}/.env.temp`;
    
    // Create merged temporary file
    await mergeEnvironmentFiles(rootEnvPath, localEnvPath, tempEnvPath);
    
    // Detect repository structure
    const repoStructure = await detectRepoStructure(repoPath);
    
    if (repoStructure.hasDockerCompose) {
        // Use Docker Compose
        console.log(`📦 Using Docker Compose (${repoStructure.composeFile})...`);
        
        // Check if docker-compose is available
        const isComposeAvailable = await isDockerComposeAvailable();
        if (!isComposeAvailable) {
            await installDockerCompose();
        }
        
        // Use temporary .env file for docker-compose
        await runCommand(`cp ${tempEnvPath} ${localEnvPath}`);
        
        // Build and start services
        await runCommand(`cd ${repoPath} && docker-compose up -d --build`);
        
        // Restore original .env file (exactly like .env.example) and clean up
        await runCommand(`find ${repoPath} -name ".env.example" -exec sh -c 'cp "$1" "$(dirname "$1")/.env"' _ {} \\;`);
        await runCommand(`rm -f ${tempEnvPath}`);
        
    } else if (repoStructure.hasDockerfile) {
        // Fallback to Docker
        console.log('📦 Using Dockerfile...');
        await installDockerService(config, repoPath);
        
    } else {
        throw new Error('No Docker configuration found in repository');
    }
}

// ============================================================================
// MAIN INSTALLATION FUNCTION
// ============================================================================

const installWithProgress = async (req, res) => {
    try {
        const solutionType = req.body?.solutionType;
        
        if (!solutionType) {
            throw new Error('Solution type is required');
        }
        
        const config = SOLUTION_CONFIGS[solutionType];
        if (!config) {
            throw new Error(`Unknown solution type: ${solutionType}`);
        }
        
        console.log(`✅ Installing solution: ${solutionType} (${config.installType})`);
        
        const repoPath = `/workspace/${config.repoName}`;
        
        // Step 1: Clean up existing repository
        console.log('🧹 Cleaning up existing repository...');
        await runCommand(`rm -rf ${repoPath}`);
        
        // Step 2: Clone repository
        console.log('📥 Cloning repository...');
        await runCommand(`git clone -b ${config.branchName} ${config.repoUrl} ${repoPath}`);
        
        // Step 3: Clean up existing containers
        await cleanupExistingContainers(config);
        
        // Step 4: Install based on service type
        if (config.installType === 'docker') {
            await installDockerService(config, repoPath);
        } else if (config.installType === 'docker-compose') {
            await installDockerComposeService(config, repoPath);
        } else {
            throw new Error(`Unsupported installation type: ${config.installType}`);
        }
        
        console.log(`✅ Installation completed! Solution running at http://localhost:${config.port}`);
        
        return { success: true, port: config.port, solutionType };
        
    } catch (error) {
        console.error(`❌ Installation failed: ${error.message}`);
        handleError(error, 'Error - solutionInstallWithProgress');
        throw error;
    }
};

module.exports = {
    installWithProgress,
};